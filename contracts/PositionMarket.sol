// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPredictionMarket {
    enum Currency { ETH, USDC, USDT, CPRED }
    struct Market {
        uint256 id;
        address creator;
        string  question;
        string  category;
        string  assetSymbol;
        uint256 targetPrice;
        bool    targetAbove;
        uint256 expiresAt;
        uint256 yesPool;
        uint256 noPool;
        uint256 yieldAccrued;
        uint8   status;
        uint8   outcome;
        address resolver;
        Currency currency;
    }
    struct Position {
        uint256 marketId;
        bool    side;
        uint256 amount;
        bool    claimed;
    }
    function getMarket(uint256 id) external view returns (Market memory);
    function getPosition(uint256 marketId, address user) external view returns (Position memory);
    function transferPosition(uint256 marketId, address from, address to) external;
}

/**
 * @title PositionMarket
 * @notice Mercato secondario per vendere/comprare posizioni aperte sui mercati
 *
 * Flusso vendita:
 *   1. Venditore chiama listPosition(marketId, askPrice)
 *      → PositionMarket diventa custode della posizione via transferPosition
 *   2. Compratore chiama buyPosition(listingId) con il pagamento
 *      → PositionMarket trasferisce la posizione al compratore
 *      → Venditore riceve askPrice - fee (0.5%)
 *   3. Venditore può cancellarla con cancelListing(listingId)
 *      → Posizione ritorna al venditore
 */
contract PositionMarket is Ownable, ReentrancyGuard {

    IPredictionMarket public immutable predMarket;

    uint256 public constant FEE_BPS = 50;  // 0.5% fee sulla vendita
    address public feeRecipient;

    // Token ERC20 per pagamenti non-ETH
    address public usdcToken;
    address public usdtToken;
    address public cpredToken;

    struct Listing {
        uint256  listingId;
        address  seller;
        uint256  marketId;
        bool     side;        // YES o NO
        uint256  amount;      // dimensione della posizione
        uint256  askPrice;    // prezzo richiesto (nella valuta del mercato)
        uint8    currency;    // 0=ETH 1=USDC 2=USDT 3=CPRED
        bool     active;
        uint256  listedAt;
    }

    uint256 public listingCount;
    mapping(uint256 => Listing) public listings;

    // Per trovare le listing di un utente
    mapping(address => uint256[]) public sellerListings;
    // listing attive per mercato
    mapping(uint256 => uint256[]) public marketListings;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed marketId, bool side, uint256 amount, uint256 askPrice, uint8 currency);
    event Sold(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price, uint256 fee);
    event Cancelled(uint256 indexed listingId, address indexed seller);

    constructor(
        address _predMarket,
        address _usdc,
        address _usdt,
        address _cpred,
        address _feeRecipient
    ) Ownable(msg.sender) {
        predMarket    = IPredictionMarket(_predMarket);
        usdcToken     = _usdc;
        usdtToken     = _usdt;
        cpredToken    = _cpred;
        feeRecipient  = _feeRecipient;
    }

    // ── LIST ──────────────────────────────────────────────────────────

    /// @notice Metti in vendita la tua posizione su un mercato
    /// @param marketId ID del mercato
    /// @param askPrice Prezzo richiesto in wei (ETH) o unità ERC20
    function listPosition(uint256 marketId, uint256 askPrice) external nonReentrant returns (uint256 listingId) {
        require(askPrice > 0, "Ask price must be > 0");

        IPredictionMarket.Position memory pos = predMarket.getPosition(marketId, msg.sender);
        require(pos.amount > 0, "No position to sell");
        require(!pos.claimed, "Position already claimed");

        IPredictionMarket.Market memory mkt = predMarket.getMarket(marketId);
        require(mkt.status == 0, "Market not open"); // 0 = Open

        // Trasferisci la posizione a questo contratto come custode
        predMarket.transferPosition(marketId, msg.sender, address(this));

        listingId = listingCount++;
        listings[listingId] = Listing({
            listingId: listingId,
            seller:    msg.sender,
            marketId:  marketId,
            side:      pos.side,
            amount:    pos.amount,
            askPrice:  askPrice,
            currency:  uint8(mkt.currency),
            active:    true,
            listedAt:  block.timestamp
        });

        sellerListings[msg.sender].push(listingId);
        marketListings[marketId].push(listingId);

        emit Listed(listingId, msg.sender, marketId, pos.side, pos.amount, askPrice, uint8(mkt.currency));
    }

    // ── BUY ───────────────────────────────────────────────────────────

    /// @notice Compra una posizione listata
    function buyPosition(uint256 listingId) external payable nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "Listing not active");
        require(l.seller != msg.sender, "Cannot buy your own listing");

        uint256 fee      = (l.askPrice * FEE_BPS) / 10000;
        uint256 toSeller = l.askPrice - fee;

        l.active = false;

        // Gestisci pagamento
        if (l.currency == 0) {
            // ETH
            require(msg.value >= l.askPrice, "Insufficient ETH");
            payable(l.seller).transfer(toSeller);
            if (fee > 0) payable(feeRecipient).transfer(fee);
            // Rimborso eccesso
            if (msg.value > l.askPrice) {
                payable(msg.sender).transfer(msg.value - l.askPrice);
            }
        } else {
            // ERC20
            require(msg.value == 0, "ETH not accepted for ERC20 market");
            address tokenAddr = _tokenAddr(l.currency);
            require(tokenAddr != address(0), "Token not configured");
            require(IERC20(tokenAddr).transferFrom(msg.sender, l.seller, toSeller), "Payment to seller failed");
            if (fee > 0) {
                require(IERC20(tokenAddr).transferFrom(msg.sender, feeRecipient, fee), "Fee transfer failed");
            }
        }

        // Trasferisci posizione al compratore
        predMarket.transferPosition(l.marketId, address(this), msg.sender);

        emit Sold(listingId, msg.sender, l.seller, l.askPrice, fee);
    }

    // ── CANCEL ────────────────────────────────────────────────────────

    /// @notice Annulla una listing e recupera la tua posizione
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "Listing not active");
        require(l.seller == msg.sender || msg.sender == owner(), "Not authorized");

        l.active = false;

        // Restituisci la posizione al venditore
        predMarket.transferPosition(l.marketId, address(this), l.seller);

        emit Cancelled(listingId, l.seller);
    }

    // ── VIEWS ─────────────────────────────────────────────────────────

    function getActiveListings(uint256 limit) external view returns (Listing[] memory result) {
        uint256 count = 0;
        for (uint256 i = 0; i < listingCount && count < limit; i++) {
            if (listings[i].active) count++;
        }
        result = new Listing[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < listingCount && idx < count; i++) {
            if (listings[i].active) result[idx++] = listings[i];
        }
    }

    function getListingsByMarket(uint256 marketId) external view returns (Listing[] memory result) {
        uint256[] memory ids = marketListings[marketId];
        uint256 active = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (listings[ids[i]].active) active++;
        }
        result = new Listing[](active);
        uint256 idx = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (listings[ids[i]].active) result[idx++] = listings[ids[i]];
        }
    }

    function getListingsBySeller(address seller) external view returns (Listing[] memory result) {
        uint256[] memory ids = sellerListings[seller];
        result = new Listing[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = listings[ids[i]];
        }
    }

    // ── ADMIN ─────────────────────────────────────────────────────────

    function setTokenAddresses(address _usdc, address _usdt, address _cpred) external onlyOwner {
        usdcToken  = _usdc;
        usdtToken  = _usdt;
        cpredToken = _cpred;
    }

    function setFeeRecipient(address _fr) external onlyOwner {
        feeRecipient = _fr;
    }

    function _tokenAddr(uint8 cur) internal view returns (address) {
        if (cur == 1) return usdcToken;
        if (cur == 2) return usdtToken;
        if (cur == 3) return cpredToken;
        return address(0);
    }

    receive() external payable {}
}
