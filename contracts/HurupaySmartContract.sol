// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract HurupaySmartContract is ReentrancyGuard, EIP712, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    uint256 public feePercentage;
    uint256 public constant MAX_FEE_PERCENTAGE = 500; // 5% max fee
    uint256 public accumulatedFees;

    mapping(bytes32 => bool) public processedRequests;

    // Events remain the same
    event Transfer(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 fee
    );
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed owner, uint256 amount);

    // Define EIP-712 typehash
    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256(
            "Transfer(bytes32 requestId,address sender,address recipient,uint256 amount,uint256 deadline,uint256 chainId)"
        );

    constructor(
        address _usdcAddress,
        uint256 _initialFeePercentage
    )
        EIP712("Hurupay", "1") // Name and version for EIP-712
        Ownable(msg.sender) // Set owner explicitly
    {
        require(_usdcAddress != address(0), "Hurupay: invalid USDC address");
        require(
            _initialFeePercentage <= MAX_FEE_PERCENTAGE,
            "Hurupay: fee too high"
        );
        usdc = IERC20(_usdcAddress);
        feePercentage = _initialFeePercentage;
    }

    function getBalance(address _user) external view returns (uint256) {
        return usdc.balanceOf(_user);
    }

    function calculateFee(uint256 _amount) public view returns (uint256) {
        uint256 fee = (_amount * feePercentage) / 10000;
        require(fee < _amount, "Hurupay: fee exceeds amount");
        return fee;
    }

    // Fee-less direct transfer
    function transfer(
        address _to,
        uint256 _amount
    ) external nonReentrant returns (bool) {
        require(_to != address(0), "Hurupay: transfer to zero address");
        require(_amount > 0, "Hurupay: amount must be greater than zero");

        // Using SafeERC20
        usdc.safeTransferFrom(msg.sender, _to, _amount);
        emit Transfer(msg.sender, _to, _amount, 0); // Fee is 0
        return true;
    }

    function executeTransferWithSignature(
        bytes32 _requestId,
        address _sender,
        address _recipient,
        uint256 _amount,
        uint256 _deadline,
        bytes memory _signature
    ) external nonReentrant returns (bool) {
        require(_sender != address(0), "Hurupay: invalid sender address");
        require(_recipient != address(0), "Hurupay: invalid recipient address");
        require(_amount > 0, "Hurupay: amount must be greater than zero");
        require(block.timestamp <= _deadline, "Hurupay: transaction expired");
        require(
            !processedRequests[_requestId],
            "Hurupay: request already processed"
        );

        // Mark request as processed first (follow checks-effects-interactions)
        processedRequests[_requestId] = true;

        // Verify signature using EIP-712
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                _requestId,
                _sender,
                _recipient,
                _amount,
                _deadline,
                block.chainid // Including chainId for cross-chain protection
            )
        );

        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, _signature);
        require(signer == _sender, "Hurupay: invalid signature");

        // Calculate fee
        uint256 fee = calculateFee(_amount);
        uint256 amountAfterFee = _amount - fee;

        // Using SafeERC20 (interactions last)
        usdc.safeTransferFrom(_sender, address(this), _amount);
        accumulatedFees += fee; // Effects
        usdc.safeTransfer(_recipient, amountAfterFee);

        emit Transfer(_sender, _recipient, amountAfterFee, fee);
        return true;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        require(amount > 0, "Hurupay: no fees to withdraw");

        // Effects before interactions
        accumulatedFees = 0;

        // Using SafeERC20
        usdc.safeTransfer(owner(), amount);

        emit FeesWithdrawn(owner(), amount);
    }

    function updateFee(uint256 _newFeePercentage) external onlyOwner {
        require(
            _newFeePercentage <= MAX_FEE_PERCENTAGE,
            "Hurupay: fee too high"
        );
        require(_newFeePercentage != feePercentage, "Hurupay: fee unchanged");
        uint256 oldFee = feePercentage;
        feePercentage = _newFeePercentage;
        emit FeeUpdated(oldFee, _newFeePercentage);
    }

    function recoverERC20(address _token) external onlyOwner nonReentrant {
        require(_token != address(0), "Hurupay: invalid token address");

        IERC20 token = IERC20(_token);
        uint256 balance = token.balanceOf(address(this));

        // If token is USDC, exclude accumulated fees
        if (_token == address(usdc)) {
            require(
                balance > accumulatedFees,
                "Hurupay: only accumulated fees available"
            );
            balance -= accumulatedFees;
        }

        require(balance > 0, "Hurupay: no tokens to recover");

        // Using SafeERC20
        token.safeTransfer(owner(), balance);
    }
}
