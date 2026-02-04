// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DeadDropRegistry
/// @notice Minimal registry for encrypted "drops" (message capsules) published on-chain.
/// @dev V1 stores capsules in contract storage for easy discovery + paging.
contract DeadDropRegistry {
    uint256 public constant MAX_CAPSULE_BYTES = 4096;

    struct Drop {
        address sender;
        address recipient;
        uint64 blockNumber;
        uint64 timestamp;
        bytes capsule;
    }

    Drop[] private drops;

    event DropCreated(
        uint256 indexed dropId,
        address indexed sender,
        address indexed recipient,
        uint64 blockNumber,
        uint64 timestamp,
        bytes capsule
    );

    function createDrop(address recipient, bytes calldata capsule) external returns (uint256 dropId) {
        require(recipient != address(0), "recipient=0");
        require(capsule.length != 0, "empty capsule");
        require(capsule.length <= MAX_CAPSULE_BYTES, "capsule too big");

        dropId = drops.length;
        uint64 bn = uint64(block.number);
        uint64 ts = uint64(block.timestamp);
        drops.push(
            Drop({sender: msg.sender, recipient: recipient, blockNumber: bn, timestamp: ts, capsule: capsule})
        );

        emit DropCreated(dropId, msg.sender, recipient, bn, ts, capsule);
    }

    function getDrop(uint256 dropId) external view returns (Drop memory) {
        require(dropId < drops.length, "dropId oob");
        return drops[dropId];
    }

    function getDropCount() external view returns (uint256) {
        return drops.length;
    }

    function getDropsRange(uint256 start, uint256 count) external view returns (Drop[] memory) {
        uint256 total = drops.length;
        if (start >= total || count == 0) return new Drop[](0);

        uint256 end = start + count;
        if (end > total) end = total;

        uint256 size = end - start;
        Drop[] memory out = new Drop[](size);
        for (uint256 i = 0; i < size; i++) {
            out[i] = drops[start + i];
        }
        return out;
    }
}
