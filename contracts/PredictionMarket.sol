// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CryptoPredictToken.sol";

/**
 * @title PredictionMarket
 * @notice Prediction market full on-chain su Base Sepolia
 *
 * Flusso:
 *   1. Admin crea un mercato (question, expiry)
 *   2. Utenti piazzano scommesse YES/NO in ETH
 *   3. Alla scadenza, admin (o oracle futuro) risolve
 *   4. Vincitori ritirano proporzionalmente al pool
 *   5. 2% fee → 1% creatore, 1% al protocollo (→ staker CPRED)
 *
 * Yield: il contratto accumula le fee e le distribuisce agli staker CPRED.
 */
contract PredictionMarket is Ownable, ReentrancyGuard {

    // ── STRUTTURE ────────────────────────────────────────────────────

    enum MarketStatus { Open, Closed, Resolved, Cancelled }
    enum Outcome      { Unresolved, YES, NO }
    enum Currency     { ETH, USDC, USDT, CPRED }

    struct Market {
        uint256 id;
        address creator;
        string  question;
        string  category;
        string  assetSymbol;
        uint256 targetPrice;    // in USD * 1e8 (es. $100k = 100000_00000000)
        bool    targetAbove;    // true = "sopra il target", false = "sotto"
        uint256 expiresAt;
        uint256 yesPool;        // ETH scommesso su YES
        uint256 noPool;         // ETH scommesso su NO
        uint256 yieldAccrued;   // yield simulato accumulato
        MarketStatus status;
        Outcome outcome;
        address resolver;       // chi ha risolto
        Currency currency;      // valuta del mercato (ETH/USDC/USDT/CPRED)
    }

    struct Position {
        uint256 marketId;
        bool    side;           // true=YES, false=NO
        uint256 amount;         // ETH scommesso
        bool    claimed;
    }

    // ── STATE ─────────────────────────────────────────────────────────

    CryptoPredictToken public cpredToken;

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => uint256[]) public userMarkets;

    // Resolvers autorizzati (oltre all'owner)
    mapping(address => bool) public resolvers;

    // Indirizzi token ERC20 per le scommesse
    address public usdcToken;
    address public usdtToken;

    // Requisito CPRED per creare mercati
    uint256 public minCpredToCreate = 1000e18;  // 1000 CPRED default
    address public presaleStaking;              // contratto staking per contare CPRED stakati

    // Fee
    uint256 public constant PLATFORM_FEE_BPS = 200;  // 2% = 200 basis points
    uint256 public constant CREATOR_FEE_BPS  = 100;  // 1%
    uint256 public constant PROTOCOL_FEE_BPS = 100;  // 1% → staker CPRED

    // CPRED holder discount
    uint256 public constant CPRED_MIN_BALANCE = 1000e18;  // 1000 CPRED = fee dimezzata
    uint256 public constant CPRED_FEE_BPS     = 100;       // 1% con CPRED

    // Yield simulato (4.8% APY)
    uint256 public constant YIELD_APY_BPS = 480;  // 4.8% = 480 bps

    // ── EVENTS ───────────────────────────────────────────────────────

    event MarketCreated(uint256 indexed id, address creator, string question, uint256 expiresAt);
    event ResolverAdded(address indexed resolver);
    event ResolverRemoved(address indexed resolver);
    event MinCpredUpdated(uint256 newMin);
    event BetPlaced(uint256 indexed marketId, address indexed user, bool side, uint256 amount);
    event MarketResolved(uint256 indexed id, Outcome outcome, address resolver);
    event PayoutClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event MarketCancelled(uint256 indexed id);
    event ProtocolFeeDistributed(uint256 indexed marketId, uint256 amount);

    // ── CONSTRUCTOR ──────────────────────────────────────────────────

    // Indirizzi valute ERC20 (impostati dal costruttore, usati per future integrazioni)
    address public mockUsdc;
    address public mockUsdt;

    constructor(
        address _cpredToken,
        address _usdc,
        address _usdt
    ) Ownable(msg.sender) {
        cpredToken = CryptoPredictToken(payable(_cpredToken));
        mockUsdc   = _usdc;
        mockUsdt   = _usdt;
        usdcToken  = _usdc;
        usdtToken  = _usdt;
    }

    // ── CPRED REQUIREMENT ────────────────────────────────────────────

    /// @notice Imposta il minimo CPRED richiesto per creare mercati (0 = disabilitato)
    function setMinCpredToCreate(uint256 _min) external onlyOwner {
        minCpredToCreate = _min;
        emit MinCpredUpdated(_min);
    }

    /// @notice Imposta l'indirizzo del contratto PresaleStaking
    function setPresaleStaking(address _staking) external onlyOwner {
        presaleStaking = _staking;
    }

    /// @notice Ritorna il balance CPRED effettivo di un utente (wallet + staked)
    function cpredBalanceOf(address user) public view returns (uint256) {
        uint256 walletBal = cpredToken.balanceOf(user);
        uint256 stakedBal = 0;
        if (presaleStaking != address(0)) {
            // Legge lo staked balance dal contratto PresaleStaking
            (bool ok, bytes memory data) = presaleStaking.staticcall(
                abi.encodeWithSignature("getTotalStaked(address)", user)
            );
            if (ok && data.length >= 32) {
                stakedBal = abi.decode(data, (uint256));
            }
        }
        return walletBal + stakedBal;
    }

    // ── RESOLVER MANAGEMENT ─────────────────────────────────────────

    function addResolver(address _resolver) external onlyOwner {
        resolvers[_resolver] = true;
        emit ResolverAdded(_resolver);
    }

    function removeResolver(address _resolver) external onlyOwner {
        resolvers[_resolver] = false;
        emit ResolverRemoved(_resolver);
    }

    // ── MODIFIERS ────────────────────────────────────────────────────

    modifier marketExists(uint256 id) {
        require(id < marketCount, "Market not found");
        _;
    }

    modifier marketOpen(uint256 id) {
        require(markets[id].status == MarketStatus.Open, "Market not open");
        require(block.timestamp < markets[id].expiresAt, "Market expired");
        _;
    }

    // ── CORE FUNCTIONS ───────────────────────────────────────────────

    /**
     * @notice Crea un nuovo mercato di predizione
     */
    function createMarket(
        string calldata question,
        string calldata category,
        string calldata assetSymbol,
        uint256 targetPrice,
        bool    targetAbove,
        uint256 expiresAt,
        Currency currency,
        uint256  liquidityAmount  // per ERC20; ignorato per ETH (usa msg.value)
    ) external payable returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(expiresAt > block.timestamp + 1 hours, "Expiry too soon");

        // Gestione liquidità per valuta
        uint256 initialLiq;
        if (currency == Currency.ETH) {
            require(msg.value >= 0.0025 ether, "Min 0.0025 ETH");
            initialLiq = msg.value;
        } else {
            require(liquidityAmount > 0, "Liquidity required");
            address tokenAddr = _currencyToken(currency);
            require(tokenAddr != address(0), "Token not configured");
            require(IERC20(tokenAddr).transferFrom(msg.sender, address(this), liquidityAmount),
                "Liquidity transfer failed");
            initialLiq = liquidityAmount;
        }

        // Verifica requisito CPRED (wallet + staked)
        if (minCpredToCreate > 0) {
            require(
                cpredBalanceOf(msg.sender) >= minCpredToCreate,
                "Insufficient CPRED: need 1000 CPRED in wallet or staking"
            );
        }

        marketId = marketCount++;
        markets[marketId] = Market({
            id:           marketId,
            creator:      msg.sender,
            question:     question,
            category:     category,
            assetSymbol:  assetSymbol,
            targetPrice:  targetPrice,
            targetAbove:  targetAbove,
            expiresAt:    expiresAt,
            yesPool:      initialLiq,
            noPool:       0,
            yieldAccrued: 0,
            status:       MarketStatus.Open,
            outcome:      Outcome.Unresolved,
            resolver:     address(0),
            currency:     currency
        });

        userMarkets[msg.sender].push(marketId);
        emit MarketCreated(marketId, msg.sender, question, expiresAt);
    }

    /**
     * @notice Piazza una scommessa YES o NO
     * @param marketId ID del mercato
     * @param side true=YES, false=NO
     */
    function placeBet(uint256 marketId, bool side)
        external
        payable
        nonReentrant
        marketExists(marketId)
        marketOpen(marketId)
    {
        require(msg.value >= 0.0001 ether, "Min bet: 0.0001 ETH");

        Market storage m = markets[marketId];
        Position storage pos = positions[marketId][msg.sender];

        // Aggiorna posizione (permetti multiple scommesse sullo stesso lato)
        if (pos.amount > 0) {
            require(pos.side == side, "Cannot bet both sides");
        } else {
            pos.marketId = marketId;
            pos.side = side;
            userMarkets[msg.sender].push(marketId);
        }

        pos.amount += msg.value;

        if (side) {
            m.yesPool += msg.value;
        } else {
            m.noPool += msg.value;
        }

        // Accrue yield simulato
        _accrueYield(m);

        emit BetPlaced(marketId, msg.sender, side, msg.value);
    }

    /**
     * @notice Risolve un mercato (owner o resolver autorizzato)
     */
    function resolveMarket(uint256 marketId, bool yesWon)
        external
        nonReentrant
        marketExists(marketId)
    {
        bool isAdmin = msg.sender == owner() || resolvers[msg.sender];
        require(isAdmin, "Not authorized to resolve");
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Open, "Not open");
        // Admin/resolver possono risolvere in anticipo (forza risoluzione)
        // Utenti normali devono aspettare la scadenza
        if (!isAdmin) {
            require(block.timestamp >= m.expiresAt, "Not expired yet");
        }

        m.status  = MarketStatus.Resolved;
        m.outcome = yesWon ? Outcome.YES : Outcome.NO;
        m.resolver = msg.sender;

        // Invia protocol fee (1%) agli staker CPRED
        uint256 totalPool = m.yesPool + m.noPool;
        if (totalPool > 0) {
            uint256 protocolFee = (totalPool * PROTOCOL_FEE_BPS) / 10000;
            if (protocolFee > 0 && address(cpredToken).balance + protocolFee <= address(this).balance) {
                cpredToken.depositRewards{value: protocolFee}();
            }
        }

        emit MarketResolved(marketId, m.outcome, msg.sender);
    }

    /**
     * @notice Ritira la vincita dopo la risoluzione
     */
    function claimPayout(uint256 marketId)
        external
        nonReentrant
        marketExists(marketId)
    {
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Resolved, "Not resolved");

        Position storage pos = positions[marketId][msg.sender];
        require(pos.amount > 0, "No position");
        require(!pos.claimed, "Already claimed");

        bool won = (m.outcome == Outcome.YES && pos.side) ||
                   (m.outcome == Outcome.NO  && !pos.side);
        require(won, "Lost position");

        pos.claimed = true;

        uint256 totalPool    = m.yesPool + m.noPool + m.yieldAccrued;
        uint256 winningPool  = m.outcome == Outcome.YES ? m.yesPool : m.noPool;

        // Quota proporzionale del pool vincente
        uint256 grossPayout = (totalPool * pos.amount) / winningPool;

        // Fee — dimezzata se hai CPRED
        uint256 feeBps = cpredToken.balanceOf(msg.sender) >= CPRED_MIN_BALANCE
            ? CPRED_FEE_BPS
            : PLATFORM_FEE_BPS;

        uint256 fee         = (grossPayout * feeBps) / 10000;
        uint256 creatorFee  = (grossPayout * CREATOR_FEE_BPS) / 10000;
        uint256 netPayout   = grossPayout - fee - creatorFee;

        // Paga creatore (1%)
        if (creatorFee > 0 && m.creator != address(0)) {
            payable(m.creator).transfer(creatorFee);
        }

        // Protocol fee (1%) → CPRED stakers via depositRewards()
        uint256 protocolFee = fee - creatorFee;
        if (protocolFee > 0) {
            try cpredToken.depositRewards{value: protocolFee}() {
                emit ProtocolFeeDistributed(marketId, protocolFee);
            } catch {
                // Se fallisce (es. nessuno sta staking) teniamo i fondi nel contratto
            }
        }

        // Paga vincitore
        payable(msg.sender).transfer(netPayout);

        emit PayoutClaimed(marketId, msg.sender, netPayout);
    }

    /**
     * @notice Cancella un mercato e rimborsa tutti
     */
    function cancelMarket(uint256 marketId)
        external
        marketExists(marketId)
    {
        require(msg.sender == owner() || resolvers[msg.sender], "Not authorized to cancel");
        Market storage m = markets[marketId];
        require(m.status == MarketStatus.Open, "Not open");
        m.status = MarketStatus.Cancelled;
        emit MarketCancelled(marketId);
    }

    /**
     * @notice Rimborso per mercato cancellato
     */
    function claimRefund(uint256 marketId)
        external
        nonReentrant
        marketExists(marketId)
    {
        require(markets[marketId].status == MarketStatus.Cancelled, "Not cancelled");
        Position storage pos = positions[marketId][msg.sender];
        require(pos.amount > 0 && !pos.claimed, "Nothing to refund");
        pos.claimed = true;
        payable(msg.sender).transfer(pos.amount);
    }

    // ── YIELD SIMULATO ───────────────────────────────────────────────

    function _accrueYield(Market storage m) internal {
        uint256 totalPool = m.yesPool + m.noPool;
        if (totalPool == 0) return;
        uint256 daysRemaining = (m.expiresAt - block.timestamp) / 1 days;
        if (daysRemaining == 0) return;
        // yield = pool * APY * daysRemaining / 365
        m.yieldAccrued = (totalPool * YIELD_APY_BPS * daysRemaining) / (10000 * 365);
    }

    // ── VIEW FUNCTIONS ───────────────────────────────────────────────

    function getMarket(uint256 id) external view returns (Market memory) {
        return markets[id];
    }

    function getPosition(uint256 marketId, address user)
        external view returns (Position memory)
    {
        return positions[marketId][user];
    }

    function getYesPct(uint256 marketId) external view returns (uint256) {
        Market storage m = markets[marketId];
        uint256 total = m.yesPool + m.noPool;
        if (total == 0) return 50;
        return (m.yesPool * 100) / total;
    }

    function getPotentialPayout(uint256 marketId, bool side, uint256 amount)
        external view returns (uint256 gross, uint256 net)
    {
        Market storage m = markets[marketId];
        uint256 totalPool   = m.yesPool + m.noPool + amount + m.yieldAccrued;
        uint256 winningPool = side ? m.yesPool + amount : m.noPool + amount;
        gross = (totalPool * amount) / winningPool;
        uint256 fee = (gross * PLATFORM_FEE_BPS) / 10000;
        net   = gross - fee;
    }

    function getUserMarkets(address user) external view returns (uint256[] memory) {
        return userMarkets[user];
    }

    function getActiveMarkets(uint256 limit) external view returns (Market[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < marketCount && count < limit; i++) {
            if (markets[i].status == MarketStatus.Open &&
                block.timestamp < markets[i].expiresAt) {
                count++;
            }
        }
        Market[] memory result = new Market[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < marketCount && idx < count; i++) {
            if (markets[i].status == MarketStatus.Open &&
                block.timestamp < markets[i].expiresAt) {
                result[idx++] = markets[i];
            }
        }
        return result;
    }

    // ── ADMIN ────────────────────────────────────────────────────────

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    /// @dev Ritorna l'indirizzo del token per una data Currency
    function _currencyToken(Currency cur) internal view returns (address) {
        if (cur == Currency.USDC) return usdcToken;
        if (cur == Currency.USDT) return usdtToken;
        if (cur == Currency.CPRED) return address(cpredToken);
        return address(0); // ETH
    }

    /// @notice Aggiorna indirizzi token ERC20
    function setTokenAddresses(address _usdc, address _usdt) external onlyOwner {
        usdcToken = _usdc;
        usdtToken = _usdt;
        mockUsdc  = _usdc;
        mockUsdt  = _usdt;
    }

    receive() external payable {}

    /// @notice Mostra ETH accumulato nel contratto (fee non distribuite)
    function accumulatedFees() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Emergency: team può distribuire manualmente i fee accumulati
    function distributeAccumulatedFees() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "Nothing to distribute");
        try cpredToken.depositRewards{value: bal}() {
            emit ProtocolFeeDistributed(0, bal);
        } catch {
            payable(owner()).transfer(bal);
        }
    }
}
