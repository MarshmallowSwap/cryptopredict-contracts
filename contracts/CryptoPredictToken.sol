// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CryptoPredictToken ($CPRED)
 * @notice Token nativo di CryptoPredict — 100M supply totale
 *
 * Distribuzione:
 *   45% → Presale (deployer)
 *   30% → Liquidità (locked nel contratto)
 *   15% → Team (vesting 12 mesi)
 *   10% → Ecosystem rewards
 */
contract CryptoPredictToken is ERC20, ERC20Burnable, Ownable {

    uint256 public constant TOTAL_SUPPLY    = 100_000_000e18;
    uint256 public constant PRESALE_SUPPLY  =  45_000_000e18;
    uint256 public constant LIQUIDITY_SUPPLY = 30_000_000e18;
    uint256 public constant TEAM_SUPPLY     =  15_000_000e18;
    uint256 public constant ECOSYSTEM_SUPPLY = 10_000_000e18;

    // Staking — chi tiene CPRED bloccato riceve rewards dal yield
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public stakeTimestamp;
    mapping(address => uint256) public pendingRewards;

    uint256 public totalStaked;
    uint256 public rewardPool;   // ETH/USDC accumulato dal yield da distribuire

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardDeposited(uint256 amount);

    constructor(
        address presaleWallet,
        address liquidityWallet,
        address teamWallet,
        address ecosystemWallet
    ) ERC20("CryptoPredict", "CPRED") Ownable(msg.sender) {
        _mint(presaleWallet,   PRESALE_SUPPLY);
        _mint(liquidityWallet, LIQUIDITY_SUPPLY);
        _mint(teamWallet,      TEAM_SUPPLY);
        _mint(ecosystemWallet, ECOSYSTEM_SUPPLY);
    }

    // ── STAKING ──────────────────────────────────────────────────────

    function stake(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");

        // Aggiorna reward pendenti prima di cambiare lo stake
        _updateRewards(msg.sender);

        _transfer(msg.sender, address(this), amount);
        stakedBalance[msg.sender] += amount;
        stakeTimestamp[msg.sender] = block.timestamp;
        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external {
        require(stakedBalance[msg.sender] >= amount, "Insufficient staked");

        _updateRewards(msg.sender);

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        _transfer(address(this), msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external {
        _updateRewards(msg.sender);
        uint256 reward = pendingRewards[msg.sender];
        require(reward > 0, "No rewards");
        pendingRewards[msg.sender] = 0;
        payable(msg.sender).transfer(reward);
        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice Deposita ETH nel reward pool — chiamato da PredictionMarket ad ogni claimPayout
    function depositRewards() external payable {
        rewardPool += msg.value;
        emit RewardDeposited(msg.value);
    }

    /// @notice ETH totale disponibile nel reward pool per gli staker
    function totalRewardPool() external view returns (uint256) {
        return rewardPool;
    }

    /// @notice Reward stimato per un utente basato sul suo stake attuale
    function estimatedReward(address user) external view returns (uint256) {
        if (totalStaked == 0 || stakedBalance[user] == 0) return pendingRewards[user];
        uint256 share = (rewardPool * stakedBalance[user]) / totalStaked;
        return pendingRewards[user] + share;
    }

    function _updateRewards(address user) internal {
        if (totalStaked == 0 || stakedBalance[user] == 0) return;
        // Calcola share proporzionale del reward pool
        uint256 userShare = (rewardPool * stakedBalance[user]) / totalStaked;
        if (userShare > 0) {
            pendingRewards[user] += userShare;
            rewardPool -= userShare;
        }
    }

    function pendingReward(address user) external view returns (uint256) {
        if (totalStaked == 0 || stakedBalance[user] == 0) return pendingRewards[user];
        uint256 share = (rewardPool * stakedBalance[user]) / totalStaked;
        return pendingRewards[user] + share;
    }

    receive() external payable {
        rewardPool += msg.value;
    }
}
