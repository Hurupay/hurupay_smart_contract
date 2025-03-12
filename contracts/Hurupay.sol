// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IERC20
 * @dev Interface for the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(
        address recipient,
        uint256 amount
    ) external returns (bool);
    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );
}

/**
 * @title Hurupay
 * @dev Smart contract for Hurupay financial platform on BASE network using USDC
 */
contract Hurupay {
    // ============ STATE VARIABLES ============
    address public owner;
    address public pendingOwner;
    IERC20 public usdc;

    uint256 public withdrawalFeePercentage;
    uint256 public constant MAX_FEE_PERCENTAGE = 500; // 5% max fee

    // Minimum fee in USDC (with 6 decimals) - 0.2 USDC
    uint256 public minimumFee = 200000;

    // Mapping to store pending withdrawal requests
    mapping(bytes32 => bool) public processedRequests;

    // ============ EVENTS ============
    event Transfer(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 fee
    );
    event WithdrawalProcessed(
        address indexed user,
        uint256 amount,
        uint256 fee
    );
    event OwnershipTransferInitiated(
        address indexed currentOwner,
        address indexed pendingOwner
    );
    event OwnershipTransferCompleted(
        address indexed previousOwner,
        address indexed newOwner
    );
    event OwnershipTransferCancelled(address indexed owner);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event MinimumFeeUpdated(uint256 oldMinimumFee, uint256 newMinimumFee);

    // ============ MODIFIERS ============
    modifier onlyOwner() {
        require(msg.sender == owner, "Hurupay: caller is not the owner");
        _;
    }

    constructor(address _usdcAddress, uint256 _initialFeePercentage) {
        require(_usdcAddress != address(0), "Hurupay: invalid USDC address");
        require(
            _initialFeePercentage <= MAX_FEE_PERCENTAGE,
            "Hurupay: fee too high"
        );

        usdc = IERC20(_usdcAddress);
        owner = msg.sender;
        withdrawalFeePercentage = _initialFeePercentage;
    }

    // ============ USER FUNCTIONS ============
    function getBalance(address _user) external view returns (uint256) {
        return usdc.balanceOf(_user);
    }

    function calculateFee(uint256 _amount) public view returns (uint256) {
        uint256 percentageFee = (_amount * withdrawalFeePercentage) / 10000;
        uint256 fee = percentageFee > minimumFee ? percentageFee : minimumFee;
        require(fee < _amount, "Hurupay: fee exceeds amount");
        return fee;
    }

    function transfer(address _to, uint256 _amount) external returns (bool) {
        require(_to != address(0), "Hurupay: transfer to zero address");
        require(_amount > 0, "Hurupay: amount must be greater than zero");

        uint256 senderBalance = usdc.balanceOf(msg.sender);
        require(senderBalance >= _amount, "Hurupay: insufficient balance");

        uint256 fee = calculateFee(_amount);
        uint256 amountAfterFee = _amount - fee;

        // Transfer fee to owner
        if (fee > 0) {
            bool feeSuccess = usdc.transferFrom(msg.sender, owner, fee);
            require(feeSuccess, "Hurupay: fee transfer failed");
        }

        // Transfer remaining amount to recipient
        bool transferSuccess = usdc.transferFrom(
            msg.sender,
            _to,
            amountAfterFee
        );
        require(transferSuccess, "Hurupay: transfer failed");

        emit Transfer(msg.sender, _to, amountAfterFee, fee);
        return true;
    }

    function withdraw(address _to, uint256 _amount) external returns (bool) {
        require(_to != address(0), "Hurupay: withdraw to zero address");
        require(_amount > 0, "Hurupay: amount must be greater than zero");

        uint256 senderBalance = usdc.balanceOf(msg.sender);
        require(senderBalance >= _amount, "Hurupay: insufficient balance");

        uint256 fee = calculateFee(_amount);
        uint256 amountAfterFee = _amount - fee;

        // Transfer fee to owner
        if (fee > 0) {
            bool feeSuccess = usdc.transferFrom(msg.sender, owner, fee);
            require(feeSuccess, "Hurupay: fee transfer failed");
        }

        // Transfer remaining amount to recipient
        bool transferSuccess = usdc.transferFrom(
            msg.sender,
            _to,
            amountAfterFee
        );
        require(transferSuccess, "Hurupay: withdrawal transfer failed");

        emit WithdrawalProcessed(msg.sender, amountAfterFee, fee);
        return true;
    }

    function executeTransferWithSignature(
        bytes32 _requestId,
        address _sender,
        address _recipient,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external returns (bool) {
        require(_sender != address(0), "Hurupay: invalid sender address");
        require(_recipient != address(0), "Hurupay: invalid recipient address");
        require(_amount > 0, "Hurupay: amount must be greater than zero");
        require(block.timestamp <= _deadline, "Hurupay: transaction expired");
        require(
            !processedRequests[_requestId],
            "Hurupay: request already processed"
        );

        // Verify signature
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encodePacked(
                        _requestId,
                        _sender,
                        _recipient,
                        _amount,
                        _deadline,
                        address(this)
                    )
                )
            )
        );
        address recoveredSigner = ecrecover(digest, _v, _r, _s);
        require(recoveredSigner == _sender, "Hurupay: invalid signature");

        uint256 senderBalance = usdc.balanceOf(_sender);
        require(senderBalance >= _amount, "Hurupay: insufficient balance");

        // Mark request as processed
        processedRequests[_requestId] = true;

        uint256 fee = calculateFee(_amount);
        uint256 amountAfterFee = _amount - fee;

        // Transfer fee to owner
        if (fee > 0) {
            bool feeSuccess = usdc.transferFrom(_sender, owner, fee);
            require(feeSuccess, "Hurupay: fee transfer failed");
        }

        // Transfer remaining amount to recipient
        bool transferSuccess = usdc.transferFrom(
            _sender,
            _recipient,
            amountAfterFee
        );
        require(transferSuccess, "Hurupay: transfer failed");

        emit Transfer(_sender, _recipient, amountAfterFee, fee);
        return true;
    }

    // ============ ADMIN FUNCTIONS ============
    function updateFee(uint256 _newFeePercentage) external onlyOwner {
        require(
            _newFeePercentage <= MAX_FEE_PERCENTAGE,
            "Hurupay: fee too high"
        );
        require(
            _newFeePercentage != withdrawalFeePercentage,
            "Hurupay: fee unchanged"
        );

        uint256 oldFee = withdrawalFeePercentage;
        withdrawalFeePercentage = _newFeePercentage;
        emit FeeUpdated(oldFee, _newFeePercentage);
    }

    function updateMinimumFee(uint256 _newMinimumFee) external onlyOwner {
        require(_newMinimumFee != minimumFee, "Hurupay: minimum fee unchanged");

        uint256 oldMinimumFee = minimumFee;
        minimumFee = _newMinimumFee;
        emit MinimumFeeUpdated(oldMinimumFee, _newMinimumFee);
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        require(
            _newOwner != address(0),
            "Hurupay: new owner is the zero address"
        );
        pendingOwner = _newOwner;
        emit OwnershipTransferInitiated(owner, pendingOwner);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        require(
            pendingOwner != address(0),
            "Hurupay: no pending ownership transfer"
        );
        pendingOwner = address(0);
        emit OwnershipTransferCancelled(owner);
    }

    function acceptOwnership() external {
        require(
            msg.sender == pendingOwner,
            "Hurupay: caller is not the pending owner"
        );
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferCompleted(oldOwner, owner);
    }

    function recoverERC20(address _token) external onlyOwner {
        IERC20 token = IERC20(_token);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "Hurupay: no tokens to recover");
        bool success = token.transfer(owner, balance);
        require(success, "Hurupay: token recovery failed");
    }
}
