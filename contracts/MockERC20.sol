// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @notice Token ERC-20 mock per testnet (USDC / USDT)
 * Chiunque può fare faucet da 10,000 token
 */
contract MockERC20 is ERC20, Ownable {
    uint8 private _decimals;
    uint256 public constant FAUCET_AMOUNT = 10_000 * 1e6; // 10,000 token (6 decimals)

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _decimals = decimals_;
        // Mint iniziale per il deployer
        _mint(msg.sender, 1_000_000 * (10 ** decimals_));
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Faucet pubblico — chiunque può ricevere token testnet
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Mint per admin
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
