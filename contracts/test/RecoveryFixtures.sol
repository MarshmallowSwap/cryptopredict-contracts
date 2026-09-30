// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// TEST-ONLY fixtures. Not collateral tokens or production wallets.
contract RecoveryTestToken is ERC20 {
    uint8 private immutable _decimals;
    uint256 public transferFeeBps;
    bool public falseTransfers;
    bool public falseTransferFrom;

    constructor(uint8 decimals_) ERC20("Recovery test token", "TEST") {
        _decimals = decimals_;
    }
    function decimals() public view override returns (uint8) { return _decimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function configure(uint256 feeBps, bool falseOut, bool falseIn) external {
        require(feeBps <= 10000);
        transferFeeBps = feeBps;
        falseTransfers = falseOut;
        falseTransferFrom = falseIn;
    }
    function transfer(address to, uint256 value) public override returns (bool) {
        if (falseTransfers) return false;
        return super.transfer(to, value);
    }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (falseTransferFrom) return false;
        return super.transferFrom(from, to, value);
    }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && transferFeeBps > 0) {
            uint256 fee = value * transferFeeBps / 10000;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

// A standard legacy-style token which returns no boolean on transfer calls.
contract RecoveryNoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external { allowance[msg.sender][spender] = amount; }
    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount);
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract RecoveryReceiver {
    address public immutable operator = msg.sender;
    bool public rejectETH;
    address public reenterTarget;
    bytes public reenterData;
    bool public reenteredSuccessfully;
    uint256 public received;

    function configure(bool reject_, address target, bytes calldata data) external {
        require(msg.sender == operator);
        rejectETH = reject_;
        reenterTarget = target;
        reenterData = data;
    }
    function execute(address target, bytes calldata data) external payable returns (bytes memory result) {
        require(msg.sender == operator);
        bool ok;
        (ok, result) = target.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
    }
    receive() external payable {
        require(!rejectETH, "Receiver rejects ETH");
        received += msg.value; // Deliberately needs more than transfer's old 2300-gas stipend.
        if (reenterTarget != address(0)) {
            (bool ok,) = reenterTarget.call(reenterData);
            reenteredSuccessfully = ok;
        }
    }
}
