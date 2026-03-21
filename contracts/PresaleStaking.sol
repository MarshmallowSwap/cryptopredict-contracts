// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CryptoPredictToken.sol";

/**
 * @title PresaleStaking
 * @notice Staking CPRED durante la presale — 3 pool con APY fisso
 *
 * Pool:
 *   0 — Flessibile  — 12% APY — nessun lock — max 10M CPRED
 *   1 — 30 giorni   — 20% APY — lock 30g    — max 10M CPRED
 *   2 — 90 giorni   — 28% APY — lock 90g    — max 10M CPRED
 *
 * Rewards: pagati in CPRED dall'allocazione Ecosystem (depositata dal team)
 * Formula: reward = stake × APY × giorniStakati / 365
 *
 * Al termine della presale (chiamata endPresale()):
 *   - Token CPRED non reclamati nel reward pool → burn
 *   - Non è possibile fare nuovi stake
 */
contract PresaleStaking is Ownable, ReentrancyGuard {

    CryptoPredictToken public immutable token;

    // ── POOL CONFIG ───────────────────────────────────────────────
    struct PoolConfig {
        uint256 apyBps;       // APY in basis points (1200 = 12%)
        uint256 lockDays;     // giorni di lock (0 = flessibile)
        uint256 maxCapacity;  // max CPRED stakabili in questo pool
        uint256 totalStaked;  // CPRED attualmente staked
    }

    PoolConfig[3] public pools;

    // ── POSITION ──────────────────────────────────────────────────
    struct Position {
        uint256 amount;       // CPRED staked
        uint256 stakedAt;     // timestamp stake
        uint256 lockedUntil;  // timestamp fine lock (0 se flessibile)
        uint256 lastClaim;    // ultimo claim reward
        bool    active;
    }

    // user → poolId → Position
    mapping(address => mapping(uint256 => Position)) public positions;
    mapping(address => uint256[]) public userPools; // pool attivi per user

    // ── PRESALE STATE ─────────────────────────────────────────────
    bool    public presaleActive = true;
    uint256 public presaleEndsAt;         // settato da owner
    uint256 public rewardPool;            // CPRED disponibili per rewards
    uint256 public totalRewardPaid;       // CPRED già pagati come reward

    // ── EVENTS ────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 poolId, uint256 amount);
    event Unstaked(address indexed user, uint256 poolId, uint256 amount, uint256 reward);
    event RewardClaimed(address indexed user, uint256 poolId, uint256 reward);
    event RewardDeposited(uint256 amount);
    event PresaleEnded(uint256 burned);

    constructor(address _token, uint256 _presaleEndsAt) Ownable(msg.sender) {
        token = CryptoPredictToken(payable(_token));
        presaleEndsAt = _presaleEndsAt;

        // Pool 0: Flessibile 12%
        pools[0] = PoolConfig({ apyBps: 1200, lockDays: 0,  maxCapacity: 10_000_000e18, totalStaked: 0 });
        // Pool 1: 30 giorni 20%
        pools[1] = PoolConfig({ apyBps: 2000, lockDays: 30, maxCapacity: 10_000_000e18, totalStaked: 0 });
        // Pool 2: 90 giorni 28%
        pools[2] = PoolConfig({ apyBps: 2800, lockDays: 90, maxCapacity: 10_000_000e18, totalStaked: 0 });
    }

    // ── ADMIN ─────────────────────────────────────────────────────

    /// @notice Deposita CPRED nel reward pool (dall'allocazione Ecosystem)
    function depositRewards(uint256 amount) external onlyOwner {
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        rewardPool += amount;
        emit RewardDeposited(amount);
    }

    /// @notice Termina la presale e brucia i reward non reclamati
    function endPresale() external onlyOwner {
        require(presaleActive, "Already ended");
        presaleActive = false;
        presaleEndsAt = block.timestamp;

        // Calcola reward non distribuiti
        uint256 contractBal = token.balanceOf(address(this));
        // Sottrai gli stake degli utenti (non bruciare quelli)
        uint256 totalUserStake = _totalUserStakes();
        uint256 toBurn = contractBal > totalUserStake ? contractBal - totalUserStake : 0;

        if (toBurn > 0) {
            token.burn(toBurn);
            emit PresaleEnded(toBurn);
        }
    }

    function setPresaleEndsAt(uint256 ts) external onlyOwner {
        presaleEndsAt = ts;
    }

    // ── STAKE ─────────────────────────────────────────────────────

    function stake(uint256 poolId, uint256 amount) external nonReentrant {
        require(presaleActive, "Presale ended");
        require(poolId < 3, "Invalid pool");
        require(amount >= 1e18, "Min 1 CPRED");

        PoolConfig storage pool = pools[poolId];
        require(pool.totalStaked + amount <= pool.maxCapacity, "Pool capacity reached");

        // Claim reward esistente prima di modificare la posizione
        _claimReward(msg.sender, poolId);

        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        Position storage pos = positions[msg.sender][poolId];
        if (!pos.active) {
            userPools[msg.sender].push(poolId);
            pos.active = true;
            pos.stakedAt = block.timestamp;
            pos.lastClaim = block.timestamp;
            pos.lockedUntil = pool.lockDays > 0
                ? block.timestamp + pool.lockDays * 1 days
                : 0;
        }
        pos.amount += amount;
        pool.totalStaked += amount;

        emit Staked(msg.sender, poolId, amount);
    }

    // ── UNSTAKE ───────────────────────────────────────────────────

    function unstake(uint256 poolId) external nonReentrant {
        require(poolId < 3, "Invalid pool");
        Position storage pos = positions[msg.sender][poolId];
        require(pos.active && pos.amount > 0, "No position");

        // Check lock (flessibile può sempre unstake; lock forzato solo se presale ancora attiva)
        if (presaleActive && pos.lockedUntil > 0) {
            require(block.timestamp >= pos.lockedUntil, "Still locked");
        }

        uint256 reward = _pendingReward(msg.sender, poolId);
        uint256 amount = pos.amount;

        pos.amount = 0;
        pos.active = false;
        pools[poolId].totalStaked -= amount;

        // Trasferisci stake + reward
        require(token.transfer(msg.sender, amount), "Stake transfer failed");
        if (reward > 0 && reward <= rewardPool) {
            rewardPool -= reward;
            totalRewardPaid += reward;
            require(token.transfer(msg.sender, reward), "Reward transfer failed");
        }

        emit Unstaked(msg.sender, poolId, amount, reward);
    }

    // ── CLAIM REWARD ──────────────────────────────────────────────

    function claimReward(uint256 poolId) external nonReentrant {
        uint256 reward = _claimReward(msg.sender, poolId);
        require(reward > 0, "No reward");
        emit RewardClaimed(msg.sender, poolId, reward);
    }

    function claimAllRewards() external nonReentrant {
        uint256 total = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (positions[msg.sender][i].active) {
                total += _claimReward(msg.sender, i);
            }
        }
        require(total > 0, "No rewards");
    }

    // ── INTERNALS ─────────────────────────────────────────────────

    function _claimReward(address user, uint256 poolId) internal returns (uint256 reward) {
        Position storage pos = positions[user][poolId];
        if (!pos.active || pos.amount == 0) return 0;

        reward = _pendingReward(user, poolId);
        pos.lastClaim = block.timestamp;

        if (reward > 0 && reward <= rewardPool) {
            rewardPool -= reward;
            totalRewardPaid += reward;
            require(token.transfer(user, reward), "Reward transfer failed");
        }
    }

    function _pendingReward(address user, uint256 poolId) internal view returns (uint256) {
        Position storage pos = positions[user][poolId];
        if (!pos.active || pos.amount == 0) return 0;

        uint256 elapsed = block.timestamp - pos.lastClaim; // secondi
        uint256 apy = pools[poolId].apyBps;
        // reward = amount × APY × elapsed / (365 days × 10000)
        return (pos.amount * apy * elapsed) / (365 days * 10000);
    }

    function _totalUserStakes() internal view returns (uint256 total) {
        // Approssimazione: somma totalStaked di tutti i pool
        for (uint256 i = 0; i < 3; i++) {
            total += pools[i].totalStaked;
        }
    }

    // ── VIEW ──────────────────────────────────────────────────────

    function pendingReward(address user, uint256 poolId) external view returns (uint256) {
        return _pendingReward(user, poolId);
    }

    function pendingRewardAll(address user) external view returns (uint256 total) {
        for (uint256 i = 0; i < 3; i++) {
            total += _pendingReward(user, i);
        }
    }

    function getPosition(address user, uint256 poolId) external view returns (
        uint256 amount, uint256 stakedAt, uint256 lockedUntil,
        uint256 pending, bool locked
    ) {
        Position storage pos = positions[user][poolId];
        amount = pos.amount;
        stakedAt = pos.stakedAt;
        lockedUntil = pos.lockedUntil;
        pending = _pendingReward(user, poolId);
        locked = pos.lockedUntil > 0 && block.timestamp < pos.lockedUntil && presaleActive;
    }

    function getPoolInfo(uint256 poolId) external view returns (
        uint256 apyBps, uint256 lockDays,
        uint256 maxCapacity, uint256 totalStaked, uint256 available
    ) {
        PoolConfig storage p = pools[poolId];
        apyBps      = p.apyBps;
        lockDays    = p.lockDays;
        maxCapacity = p.maxCapacity;
        totalStaked = p.totalStaked;
        available   = p.maxCapacity > p.totalStaked ? p.maxCapacity - p.totalStaked : 0;
    }

    function getAllPoolsInfo() external view returns (
        uint256[3] memory apys, uint256[3] memory locks,
        uint256[3] memory totals, uint256[3] memory caps
    ) {
        for (uint256 i = 0; i < 3; i++) {
            apys[i]   = pools[i].apyBps;
            locks[i]  = pools[i].lockDays;
            totals[i] = pools[i].totalStaked;
            caps[i]   = pools[i].maxCapacity;
        }
    }

    function getUserPositions(address user) external view returns (
        uint256[3] memory amounts, uint256[3] memory pendings,
        uint256[3] memory lockedUntils, bool[3] memory locked
    ) {
        for (uint256 i = 0; i < 3; i++) {
            Position storage pos = positions[user][i];
            amounts[i]      = pos.amount;
            pendings[i]     = _pendingReward(user, i);
            lockedUntils[i] = pos.lockedUntil;
            locked[i]       = pos.lockedUntil > 0 && block.timestamp < pos.lockedUntil && presaleActive;
        }
    }

    function timeUntilUnlock(address user, uint256 poolId) external view returns (uint256) {
        Position storage pos = positions[user][poolId];
        if (pos.lockedUntil == 0 || block.timestamp >= pos.lockedUntil) return 0;
        return pos.lockedUntil - block.timestamp;
    }

    function rewardPoolBalance() external view returns (uint256) {
        return rewardPool;
    }

    receive() external payable {}
}
