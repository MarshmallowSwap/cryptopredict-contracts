// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CryptoPredictToken.sol";

/**
 * @title CPREDPresale
 * @notice Presale a 3 stage per $CPRED
 *
 * Stage 1: $0.050 → 20M CPRED
 * Stage 2: $0.075 → 15M CPRED
 * Stage 3: $0.100 → 10M CPRED
 *
 * Su testnet usiamo ETH invece di USDC (più semplice)
 * 1 ETH = 2000 USD (prezzo mock)
 */
contract CPREDPresale is Ownable, ReentrancyGuard {

    CryptoPredictToken public token;

    uint256 public constant ETH_PRICE_USD = 2000;  // mock, in produzione usa oracle

    struct Stage {
        uint256 priceUsdCents;  // prezzo in centesimi USD (5 = $0.050)
        uint256 allocation;     // CPRED disponibili in questo stage
        uint256 sold;           // CPRED venduti
        bool    active;
    }

    Stage[3] public stages;
    uint256 public currentStage;
    bool    public presaleActive;

    mapping(address => uint256) public purchased;
    uint256 public totalRaised;

    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 cpredAmount, uint256 stage);
    event StageAdvanced(uint256 newStage);
    event PresaleEnded();

    constructor(address _token) Ownable(msg.sender) {
        token = CryptoPredictToken(payable(_token));

        stages[0] = Stage({ priceUsdCents: 5,  allocation: 20_000_000e18, sold: 0, active: true });
        stages[1] = Stage({ priceUsdCents: 8,  allocation: 15_000_000e18, sold: 0, active: false });
        stages[2] = Stage({ priceUsdCents: 10, allocation: 10_000_000e18, sold: 0, active: false });

        presaleActive = true;
    }

    /**
     * @notice Acquista CPRED inviando ETH
     */
    function buyTokens() external payable nonReentrant {
        require(presaleActive, "Presale not active");
        require(msg.value >= 0.001 ether, "Min 0.001 ETH");

        Stage storage s = stages[currentStage];
        require(s.active, "Stage not active");

        // Calcola CPRED da ricevere
        // ETH → USD → CPRED
        uint256 usdValue   = (msg.value * ETH_PRICE_USD) / 1e18;  // in USD
        uint256 cpredAmount = (usdValue * 100 * 1e18) / s.priceUsdCents;

        // Controlla disponibilità nello stage
        uint256 remaining = s.allocation - s.sold;
        if (cpredAmount > remaining) {
            cpredAmount = remaining;
            // Rimborsa ETH in eccesso
            uint256 ethUsed = (cpredAmount * s.priceUsdCents) / (ETH_PRICE_USD * 100);
            uint256 refund = msg.value - ethUsed;
            if (refund > 0) payable(msg.sender).transfer(refund);
        }

        require(cpredAmount > 0, "No tokens available");

        s.sold     += cpredAmount;
        purchased[msg.sender] += cpredAmount;
        totalRaised += msg.value;

        // Trasferisci CPRED
        token.transfer(msg.sender, cpredAmount);

        emit TokensPurchased(msg.sender, msg.value, cpredAmount, currentStage);

        // Auto-avanza stage se esaurito
        if (s.sold >= s.allocation) {
            _advanceStage();
        }
    }

    function _advanceStage() internal {
        if (currentStage < 2) {
            stages[currentStage].active = false;
            currentStage++;
            stages[currentStage].active = true;
            emit StageAdvanced(currentStage);
        } else {
            presaleActive = false;
            emit PresaleEnded();
        }
    }

    function advanceStage() external onlyOwner {
        _advanceStage();
    }

    function endPresale() external onlyOwner {
        presaleActive = false;
        emit PresaleEnded();
    }

    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function withdrawUnsoldTokens() external onlyOwner {
        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) token.transfer(owner(), bal);
    }

    function getStageInfo() external view returns (Stage[3] memory) {
        return stages;
    }

    function getCpredForEth(uint256 ethAmount) external view returns (uint256) {
        Stage storage s = stages[currentStage];
        uint256 usdValue = (ethAmount * ETH_PRICE_USD) / 1e18;
        return (usdValue * 100 * 1e18) / s.priceUsdCents;
    }

    receive() external payable {
        this.buyTokens();
    }
}
