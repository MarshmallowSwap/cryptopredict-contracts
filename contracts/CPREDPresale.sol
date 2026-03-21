// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CryptoPredictToken.sol";

/**
 * @title CPREDPresale v2
 * @notice Presale 3-stage con doppio trigger di avanzamento:
 *   1. Sell-out  — lo stage esaurisce i token disponibili
 *   2. Timer     — scadono i giorni allocati allo stage (3g testnet / 15g mainnet)
 *
 * In entrambi i casi i token rimasti vengono BRUCIATI automaticamente.
 *
 * Stage 1: $0.050 · 20M CPRED · 3 giorni
 * Stage 2: $0.075 · 15M CPRED · 3 giorni
 * Stage 3: $0.100 · 10M CPRED · 3 giorni
 * Listing target: $0.150
 */
contract CPREDPresale is Ownable, ReentrancyGuard {

    CryptoPredictToken public immutable token;

    uint256 public constant ETH_PRICE_USD  = 2000;
    uint256 public constant STAGE_DURATION = 3 days; // testnet: 3 giorni (mainnet: 15 days)

    struct Stage {
        uint256 priceUsdCents;
        uint256 allocation;
        uint256 sold;
        uint256 startTime;
        bool    active;
    }

    Stage[3] public stages;
    uint256  public currentStage;
    bool     public presaleActive;

    mapping(address => uint256) public purchased;
    uint256 public totalRaised;
    uint256 public totalBurned;

    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 cpredAmount, uint256 stage);
    event StageAdvanced(uint256 oldStage, uint256 newStage, uint256 burned);
    event StageBurned(uint256 stage, uint256 burned);
    event PresaleEnded(uint256 totalBurned);

    constructor(address _token) Ownable(msg.sender) {
        token = CryptoPredictToken(payable(_token));
        stages[0] = Stage({ priceUsdCents: 5,  allocation: 20_000_000e18, sold: 0, startTime: block.timestamp, active: true  });
        stages[1] = Stage({ priceUsdCents: 8,  allocation: 15_000_000e18, sold: 0, startTime: 0,               active: false });
        stages[2] = Stage({ priceUsdCents: 10, allocation: 10_000_000e18, sold: 0, startTime: 0,               active: false });
        presaleActive = true;
    }

    // ── VIEW ──────────────────────────────────────────────────────

    function currentStageEndsAt() external view returns (uint256) {
        return stages[currentStage].startTime + STAGE_DURATION;
    }

    function timeRemainingCurrentStage() external view returns (uint256) {
        if (!presaleActive) return 0;
        uint256 endsAt = stages[currentStage].startTime + STAGE_DURATION;
        if (block.timestamp >= endsAt) return 0;
        return endsAt - block.timestamp;
    }

    function isCurrentStageExpired() public view returns (bool) {
        if (!presaleActive) return false;
        return block.timestamp >= stages[currentStage].startTime + STAGE_DURATION;
    }

    function getCpredForEth(uint256 ethAmount) external view returns (uint256) {
        uint256 usdValue = (ethAmount * ETH_PRICE_USD) / 1e18;
        return (usdValue * 100 * 1e18) / stages[currentStage].priceUsdCents;
    }

    function getStageInfo() external view returns (Stage[3] memory) {
        return stages;
    }

    // ── ACQUISTO ──────────────────────────────────────────────────

    function buyTokens() external payable nonReentrant {
        require(presaleActive, "Presale not active");
        require(msg.value >= 0.001 ether, "Min 0.001 ETH");

        // Auto-avanza se il timer è scaduto
        if (isCurrentStageExpired()) _advanceStage();
        require(presaleActive, "Presale ended");

        Stage storage s = stages[currentStage];

        uint256 usdValue    = (msg.value * ETH_PRICE_USD) / 1e18;
        uint256 cpredAmount = (usdValue * 100 * 1e18) / s.priceUsdCents;
        uint256 remaining   = s.allocation - s.sold;
        uint256 ethUsed     = msg.value;

        if (cpredAmount > remaining) {
            cpredAmount = remaining;
            uint256 usdNeeded = (cpredAmount * s.priceUsdCents) / (100 * 1e18);
            ethUsed = (usdNeeded * 1e18) / ETH_PRICE_USD + 1; // +1 wei rounding
            if (ethUsed > msg.value) ethUsed = msg.value;
            uint256 refund = msg.value - ethUsed;
            if (refund > 1000) payable(msg.sender).transfer(refund);
        }

        require(cpredAmount > 0, "No tokens left in stage");

        s.sold             += cpredAmount;
        purchased[msg.sender] += cpredAmount;
        totalRaised        += ethUsed;

        token.transfer(msg.sender, cpredAmount);
        emit TokensPurchased(msg.sender, ethUsed, cpredAmount, currentStage);

        // Sell-out → avanza stage
        if (s.sold >= s.allocation) _advanceStage();
    }

    // ── AVANZAMENTO ───────────────────────────────────────────────

    /// @notice Chiunque può triggerare l'avanzamento se lo stage è scaduto
    function advanceExpiredStage() external {
        require(presaleActive, "Not active");
        require(isCurrentStageExpired(), "Not expired");
        _advanceStage();
    }

    function forceAdvanceStage() external onlyOwner {
        require(presaleActive, "Not active");
        _advanceStage();
    }

    function _advanceStage() internal {
        uint256 old = currentStage;

        // Brucia i token rimasti nello stage
        uint256 leftover = stages[old].allocation - stages[old].sold;
        if (leftover > 0) {
            stages[old].allocation = stages[old].sold; // reset per evita doppio burn
            uint256 bal = token.balanceOf(address(this));
            uint256 toBurn = bal < leftover ? bal : leftover;
            if (toBurn > 0) {
                token.burn(toBurn);
                totalBurned += toBurn;
                emit StageBurned(old, toBurn);
            }
        }

        stages[old].active = false;

        if (currentStage < 2) {
            currentStage++;
            stages[currentStage].active    = true;
            stages[currentStage].startTime = block.timestamp; // timer riparte
            emit StageAdvanced(old, currentStage, leftover);
        } else {
            presaleActive = false;
            emit PresaleEnded(totalBurned);
        }
    }

    // ── ADMIN ─────────────────────────────────────────────────────

    function endPresale() external onlyOwner {
        require(presaleActive, "Already ended");
        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) { token.burn(bal); totalBurned += bal; }
        presaleActive = false;
        emit PresaleEnded(totalBurned);
    }

    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable { this.buyTokens{value: msg.value}(); }
}
