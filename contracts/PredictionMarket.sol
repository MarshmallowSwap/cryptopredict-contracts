// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PredictionMarket — recovery candidate, NEW DEPLOYMENT ONLY
 * @notice Testnet-only pari-mutuel YES/NO markets, not an AMM.
 * @dev Initial collateral is a real YES position owned by the creator, NOT
 * neutral LP liquidity. Amounts always use the market currency's atomic units.
 * No synthetic yield is payable. Claims create separate pull-payment fee credits.
 * Legacy tuple layouts/selectors are retained where possible, but storage and
 * accounting are NOT upgrade compatible. Existing deployments are untouched.
 */
contract PredictionMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum MarketStatus { Open, Closed, Resolved, Cancelled }
    enum Outcome { Unresolved, YES, NO }
    enum Currency { ETH, USDC, USDT, CPRED }

    struct Market {
        uint256 id;
        address creator;
        string question;
        string category;
        string assetSymbol;
        uint256 targetPrice;
        bool targetAbove;
        uint256 expiresAt;
        uint256 yesPool;
        uint256 noPool;
        uint256 yieldAccrued; // ABI compatibility only: always zero in this version.
        MarketStatus status;
        Outcome outcome;
        address resolver;
        Currency currency;
    }

    struct Position {
        uint256 marketId;
        bool side;
        uint256 amount;
        bool claimed;
    }

    IERC20 public immutable cpredToken;
    address public usdcToken;
    address public usdtToken;
    address public mockUsdc;
    address public mockUsdt;
    address public presaleStaking;
    address public positionMarket;
    uint256 public minCpredToCreate = 1000e18;
    uint256 public marketCount;
    uint256 public constant PLATFORM_FEE_BPS = 200;
    uint256 public constant CREATOR_FEE_BPS = 100;
    uint256 public constant PROTOCOL_FEE_BPS = 100;
    uint256 public constant CPRED_MIN_BALANCE = 1000e18;
    uint256 public constant CPRED_FEE_BPS = 100;
    uint256 public constant YIELD_APY_BPS = 0;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => uint256[]) public userMarkets;
    mapping(address => mapping(uint256 => bool)) private _userMarketSeen;
    mapping(address => bool) public resolvers;

    // Token identities cannot change after the first market is created.
    mapping(uint256 => address) public marketToken;
    mapping(uint256 => uint256) public marketEscrow;
    mapping(Currency => uint256) public totalEscrow;
    mapping(Currency => uint256) public protocolFees;
    mapping(Currency => uint256) public totalCreatorFees;
    mapping(Currency => mapping(address => uint256)) public creatorFees;

    event MarketCreated(uint256 indexed id, address creator, string question, uint256 expiresAt);
    event ResolverAdded(address indexed resolver);
    event ResolverRemoved(address indexed resolver);
    event MinCpredUpdated(uint256 newMin);
    event BetPlaced(uint256 indexed marketId, address indexed user, bool side, uint256 amount);
    event MarketResolved(uint256 indexed id, Outcome outcome, address resolver);
    event PayoutClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event MarketCancelled(uint256 indexed id);
    event RefundClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event PositionTransferred(uint256 indexed marketId, address indexed from, address indexed to, uint256 amount);
    event FeesAccrued(uint256 indexed marketId, Currency currency, uint256 creatorFee, uint256 protocolFee);
    event CreatorFeesClaimed(address indexed creator, Currency currency, address recipient, uint256 amount);
    event ProtocolFeesWithdrawn(Currency currency, address recipient, uint256 amount);

    constructor(address _cpredToken, address _usdc, address _usdt) Ownable(msg.sender) {
        require(block.chainid == 31337 || block.chainid == 84532, "Recovery: testnet only");
        require(_cpredToken.code.length > 0, "Invalid CPRED token");
        cpredToken = IERC20(_cpredToken);
        _setTokenAddresses(_usdc, _usdt);
    }

    modifier marketExists(uint256 id) {
        require(id < marketCount, "Market not found");
        _;
    }

    modifier marketOpen(uint256 id) {
        require(markets[id].status == MarketStatus.Open, "Market not open");
        require(block.timestamp < markets[id].expiresAt, "Market expired");
        _;
    }

    function setMinCpredToCreate(uint256 minimum) external onlyOwner {
        minCpredToCreate = minimum;
        emit MinCpredUpdated(minimum);
    }

    function setPresaleStaking(address staking) external onlyOwner {
        require(marketCount == 0, "Configuration frozen");
        require(staking == address(0) || staking.code.length > 0, "Invalid staking contract");
        presaleStaking = staking;
    }

    function cpredBalanceOf(address user) public view returns (uint256) {
        uint256 balance = cpredToken.balanceOf(user);
        if (presaleStaking != address(0)) {
            (bool ok, bytes memory data) = presaleStaking.staticcall(
                abi.encodeWithSignature("getTotalStaked(address)", user)
            );
            if (ok && data.length >= 32) balance += abi.decode(data, (uint256));
        }
        return balance;
    }

    function addResolver(address resolver) external onlyOwner {
        require(resolver != address(0), "Invalid resolver");
        resolvers[resolver] = true;
        emit ResolverAdded(resolver);
    }

    function removeResolver(address resolver) external onlyOwner {
        resolvers[resolver] = false;
        emit ResolverRemoved(resolver);
    }

    function createMarket(
        string calldata question, string calldata category, string calldata assetSymbol,
        uint256 targetPrice, bool targetAbove, uint256 expiresAt,
        Currency currency, uint256 liquidityAmount
    ) external payable nonReentrant returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(expiresAt > block.timestamp + 1 hours, "Expiry too soon");
        require(cpredBalanceOf(msg.sender) >= minCpredToCreate, "Insufficient CPRED");
        uint256 initial;
        address token = _currencyToken(currency);
        if (currency == Currency.ETH) {
            require(liquidityAmount == 0, "Unexpected token amount");
            require(msg.value >= 0.0025 ether, "Min 0.0025 ETH");
            initial = msg.value;
        } else {
            require(msg.value == 0, "Unexpected ETH");
            require(liquidityAmount > 0, "Liquidity required");
            initial = liquidityAmount;
            _receiveToken(token, initial);
        }
        marketId = marketCount++;
        markets[marketId] = Market({
            id: marketId, creator: msg.sender, question: question, category: category,
            assetSymbol: assetSymbol, targetPrice: targetPrice, targetAbove: targetAbove,
            expiresAt: expiresAt, yesPool: initial, noPool: 0, yieldAccrued: 0,
            status: MarketStatus.Open, outcome: Outcome.Unresolved,
            resolver: address(0), currency: currency
        });
        marketToken[marketId] = token;
        positions[marketId][msg.sender] = Position(marketId, true, initial, false);
        _rememberMarket(msg.sender, marketId);
        _creditEscrow(marketId, initial);
        emit MarketCreated(marketId, msg.sender, question, expiresAt);
        emit BetPlaced(marketId, msg.sender, true, initial);
    }

    function placeBet(uint256 marketId, bool side)
        external payable nonReentrant marketExists(marketId) marketOpen(marketId)
    {
        require(markets[marketId].currency == Currency.ETH, "Use placeBetERC20 for token markets");
        require(msg.value >= 0.0001 ether, "Min bet: 0.0001 ETH");
        _recordBet(marketId, side, msg.value);
    }

    function placeBetERC20(uint256 marketId, bool side, uint8 curIdx, uint256 amount)
        external nonReentrant marketExists(marketId) marketOpen(marketId)
    {
        Market storage m = markets[marketId];
        require(m.currency != Currency.ETH, "Use placeBet for ETH markets");
        require(uint8(m.currency) == curIdx, "Wrong currency for this market");
        require(amount > 0, "Amount must be > 0");
        _receiveToken(marketToken[marketId], amount);
        _recordBet(marketId, side, amount);
    }

    function _recordBet(uint256 marketId, bool side, uint256 amount) internal {
        Position storage pos = positions[marketId][msg.sender];
        if (pos.amount > 0) {
            require(!pos.claimed && pos.side == side, "Cannot bet both sides");
        } else {
            pos.marketId = marketId;
            pos.side = side;
            pos.claimed = false; // A former sender may acquire a new position.
            _rememberMarket(msg.sender, marketId);
        }
        pos.amount += amount;
        Market storage m = markets[marketId];
        if (side) m.yesPool += amount;
        else m.noPool += amount;
        _creditEscrow(marketId, amount);
        emit BetPlaced(marketId, msg.sender, side, amount);
    }

    function resolveMarket(uint256 marketId, bool yesWon)
        external nonReentrant marketExists(marketId)
    {
        require(msg.sender == owner() || resolvers[msg.sender], "Not authorized to resolve");
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Open, "Not open");
        require(block.timestamp >= m.expiresAt, "Not expired yet");
        m.resolver = msg.sender;
        // No winning stake: preserve a fee-free refund path, not stranded collateral.
        if ((yesWon ? m.yesPool : m.noPool) == 0) {
            m.status = MarketStatus.Cancelled;
            emit MarketCancelled(marketId);
            return;
        }
        m.status = MarketStatus.Resolved;
        m.outcome = yesWon ? Outcome.YES : Outcome.NO;
        // Resolution neither pays fees nor moves collateral to another contract.
        emit MarketResolved(marketId, m.outcome, msg.sender);
    }

    function claimPayout(uint256 marketId) external nonReentrant marketExists(marketId) {
        _claimPayout(marketId, msg.sender);
    }

    function claimPayoutTo(uint256 marketId, address recipient)
        external nonReentrant marketExists(marketId)
    {
        _claimPayout(marketId, recipient);
    }

    function _claimPayout(uint256 marketId, address recipient) internal {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Resolved, "Not resolved");
        Position storage pos = positions[marketId][msg.sender];
        require(pos.amount > 0, "No position");
        require(!pos.claimed, "Already claimed");
        require((m.outcome == Outcome.YES) == pos.side, "Lost position");
        (uint256 gross, uint256 net, uint256 creatorFee, uint256 protocolFee) =
            _payoutAmounts(m, pos, msg.sender);
        pos.claimed = true;
        _debitEscrow(marketId, gross);
        creatorFees[m.currency][m.creator] += creatorFee;
        totalCreatorFees[m.currency] += creatorFee;
        protocolFees[m.currency] += protocolFee;
        // Pull credits prevent a rejecting creator/fee recipient blocking a winner.
        _sendAsset(m.currency, recipient, net);
        emit FeesAccrued(marketId, m.currency, creatorFee, protocolFee);
        emit PayoutClaimed(marketId, msg.sender, net);
    }

    function _payoutAmounts(Market storage m, Position storage pos, address user)
        internal view returns (uint256 gross, uint256 net, uint256 creatorFee, uint256 protocolFee)
    {
        uint256 winningPool = m.outcome == Outcome.YES ? m.yesPool : m.noPool;
        gross = Math.mulDiv(m.yesPool + m.noPool, pos.amount, winningPool);
        uint256 rate = cpredToken.balanceOf(user) >= CPRED_MIN_BALANCE
            ? CPRED_FEE_BPS : PLATFORM_FEE_BPS;
        uint256 totalFee = Math.mulDiv(gross, rate, 10000);
        creatorFee = Math.mulDiv(gross, CREATOR_FEE_BPS, 10000);
        protocolFee = totalFee - creatorFee;
        net = gross - totalFee; // Creator fee is INCLUDED, not deducted a second time.
    }

    function cancelMarket(uint256 marketId) external nonReentrant marketExists(marketId) {
        require(msg.sender == owner() || resolvers[msg.sender], "Not authorized to cancel");
        require(markets[marketId].status == MarketStatus.Open, "Not open");
        markets[marketId].status = MarketStatus.Cancelled;
        emit MarketCancelled(marketId);
    }

    function claimRefund(uint256 marketId) external nonReentrant marketExists(marketId) {
        _claimRefund(marketId, msg.sender);
    }

    function claimRefundTo(uint256 marketId, address recipient)
        external nonReentrant marketExists(marketId)
    {
        _claimRefund(marketId, recipient);
    }

    function _claimRefund(uint256 marketId, address recipient) internal {
        require(markets[marketId].status == MarketStatus.Cancelled, "Not cancelled");
        Position storage pos = positions[marketId][msg.sender];
        require(pos.amount > 0 && !pos.claimed, "Nothing to refund");
        pos.claimed = true;
        _debitEscrow(marketId, pos.amount);
        _sendAsset(markets[marketId].currency, recipient, pos.amount);
        emit RefundClaimed(marketId, msg.sender, pos.amount);
    }

    function claimCreatorFees(Currency currency, address recipient) external nonReentrant {
        uint256 amount = creatorFees[currency][msg.sender];
        require(amount > 0, "No creator fees");
        creatorFees[currency][msg.sender] = 0;
        totalCreatorFees[currency] -= amount;
        _sendAsset(currency, recipient, amount);
        emit CreatorFeesClaimed(msg.sender, currency, recipient, amount);
    }

    /// @notice Legacy selector, now limited to accrued ETH PROTOCOL fees only.
    function withdraw() external onlyOwner nonReentrant {
        _withdrawProtocolFees(Currency.ETH, owner());
    }

    function withdrawProtocolFees(Currency currency, address recipient)
        external onlyOwner nonReentrant
    {
        _withdrawProtocolFees(currency, recipient);
    }

    function _withdrawProtocolFees(Currency currency, address recipient) internal {
        uint256 amount = protocolFees[currency];
        require(amount > 0, "No protocol fees");
        protocolFees[currency] = 0;
        _sendAsset(currency, recipient, amount);
        emit ProtocolFeesWithdrawn(currency, recipient, amount);
    }

    /// @dev Do not feed the unaudited legacy staking engine automatically.
    function distributeAccumulatedFees() external onlyOwner {
        revert("Legacy staking distribution disabled");
    }

    function accumulatedFees() external view returns (uint256) {
        return protocolFees[Currency.ETH];
    }

    function accountedBalance(Currency currency) public view returns (uint256) {
        return totalEscrow[currency] + totalCreatorFees[currency] + protocolFees[currency];
    }

    function _creditEscrow(uint256 marketId, uint256 amount) internal {
        marketEscrow[marketId] += amount;
        totalEscrow[markets[marketId].currency] += amount;
    }

    function _debitEscrow(uint256 marketId, uint256 amount) internal {
        require(amount <= marketEscrow[marketId], "Insufficient market escrow");
        marketEscrow[marketId] -= amount;
        totalEscrow[markets[marketId].currency] -= amount;
    }

    function _receiveToken(address tokenAddress, uint256 amount) internal {
        IERC20 token = IERC20(tokenAddress);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(token.balanceOf(address(this)) == beforeBalance + amount, "Unsupported token transfer");
    }

    function _sendAsset(Currency currency, address recipient, uint256 amount) internal {
        require(recipient != address(0) && recipient != address(this), "Invalid recipient");
        if (amount == 0) return;
        if (currency == Currency.ETH) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20 token = IERC20(_currencyToken(currency));
            uint256 beforeSender = token.balanceOf(address(this));
            uint256 beforeRecipient = token.balanceOf(recipient);
            token.safeTransfer(recipient, amount);
            require(token.balanceOf(address(this)) == beforeSender - amount &&
                token.balanceOf(recipient) == beforeRecipient + amount, "Unsupported token transfer");
        }
        // Reserved collateral and fee credits must remain fully covered in this currency.
        uint256 balance = currency == Currency.ETH ? address(this).balance
            : IERC20(_currencyToken(currency)).balanceOf(address(this));
        require(balance >= accountedBalance(currency), "Accounting not covered");
    }

    function _currencyToken(Currency currency) internal view returns (address) {
        if (currency == Currency.USDC) return usdcToken;
        if (currency == Currency.USDT) return usdtToken;
        if (currency == Currency.CPRED) return address(cpredToken);
        return address(0);
    }

    function setTokenAddresses(address usdc, address usdt) external onlyOwner nonReentrant {
        require(marketCount == 0, "Configuration frozen");
        _setTokenAddresses(usdc, usdt);
    }

    function _setTokenAddresses(address usdc, address usdt) internal {
        require(usdc.code.length > 0 && usdt.code.length > 0, "Invalid collateral token");
        require(usdc != usdt && usdc != address(cpredToken) && usdt != address(cpredToken), "Duplicate currency token");
        usdcToken = usdc;
        usdtToken = usdt;
        mockUsdc = usdc;
        mockUsdt = usdt;
    }

    function transferPosition(uint256 marketId, address from, address to)
        external nonReentrant marketExists(marketId) marketOpen(marketId)
    {
        require(msg.sender == from || msg.sender == positionMarket, "Not authorized to transfer");
        require(from != to && to != address(0) && to != address(this), "Invalid recipient");
        Position storage source = positions[marketId][from];
        Position storage target = positions[marketId][to];
        require(source.amount > 0 && !source.claimed, "No position to transfer");
        uint256 moved = source.amount;
        if (target.amount > 0) {
            require(!target.claimed && target.side == source.side, "Cannot merge opposite sides");
        } else {
            target.marketId = marketId;
            target.side = source.side;
            target.claimed = false;
            _rememberMarket(to, marketId);
        }
        target.amount += moved;
        source.amount = 0;
        source.claimed = true;
        emit PositionTransferred(marketId, from, to, moved);
    }

    function setPositionMarket(address secondary) external onlyOwner {
        require(marketCount == 0, "Configuration frozen");
        require(secondary == address(0) || secondary.code.length > 0, "Invalid secondary contract");
        positionMarket = secondary;
    }

    function _rememberMarket(address user, uint256 marketId) internal {
        if (!_userMarketSeen[user][marketId]) {
            _userMarketSeen[user][marketId] = true;
            userMarkets[user].push(marketId);
        }
    }

    function getMarket(uint256 id) external view marketExists(id) returns (Market memory) {
        return markets[id];
    }

    function getPosition(uint256 marketId, address user)
        external view marketExists(marketId) returns (Position memory)
    {
        return positions[marketId][user];
    }

    function getYesPct(uint256 marketId) external view marketExists(marketId) returns (uint256) {
        Market storage m = markets[marketId];
        return Math.mulDiv(m.yesPool, 100, m.yesPool + m.noPool);
    }

    /// @notice Marginal NEW stake quote, conservative 2% fee; not a fixed odds promise.
    function getPotentialPayout(uint256 marketId, bool side, uint256 amount)
        external view marketExists(marketId) marketOpen(marketId) returns (uint256 gross, uint256 net)
    {
        if (amount == 0) return (0, 0);
        Market storage m = markets[marketId];
        uint256 winning = (side ? m.yesPool : m.noPool) + amount;
        gross = Math.mulDiv(m.yesPool + m.noPool + amount, amount, winning);
        net = gross - Math.mulDiv(gross, PLATFORM_FEE_BPS, 10000);
    }

    /// @notice Claim quote for an existing winning position at current CPRED eligibility.
    function previewPayout(uint256 marketId, address user)
        external view marketExists(marketId)
        returns (uint256 gross, uint256 net, uint256 creatorFee, uint256 protocolFee)
    {
        Market storage m = markets[marketId];
        Position storage pos = positions[marketId][user];
        if (m.status != MarketStatus.Resolved || pos.amount == 0 || pos.claimed ||
            ((m.outcome == Outcome.YES) != pos.side)) return (0, 0, 0, 0);
        return _payoutAmounts(m, pos, user);
    }

    function getUserMarkets(address user) external view returns (uint256[] memory) {
        return userMarkets[user];
    }

    function getActiveMarkets(uint256 limit) external view returns (Market[] memory) {
        uint256 count;
        for (uint256 i; i < marketCount && count < limit; i++) {
            if (markets[i].status == MarketStatus.Open && block.timestamp < markets[i].expiresAt) count++;
        }
        Market[] memory result = new Market[](count);
        uint256 index;
        for (uint256 i; i < marketCount && index < count; i++) {
            if (markets[i].status == MarketStatus.Open && block.timestamp < markets[i].expiresAt) result[index++] = markets[i];
        }
        return result;
    }

    // Donations/forced ETH are NOT protocol fees and have no automatic sweep path.
    receive() external payable {}
}
