import { useEffect, useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { bytesToHex, hexToBytes } from 'viem';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { decodeCapsuleV1, encryptMessageV1 } from '../ddrp/capsuleV1';
import { useRegistryConfig } from '../ddrp/registryConfig';
import { getRecipientPublicKey, parseRecipientAddress } from '../ddrp/pubkeyDiscovery';
import { DEAD_DROP_REGISTRY_ABI } from '../ddrp/registry';
import { AddressChip } from '../components/AddressChip';

const MAX_MESSAGE_CHARS = 500;

function formatTimestampSeconds(seconds: bigint): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return seconds.toString();
  return new Date(ms).toLocaleString();
}

function truncateHex(value: Hex, start = 10, end = 8): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function HomePage() {
  const registry = useRegistryConfig();
  const publicClient = usePublicClient();
  const { address: activeAddress, isConnected } = useAccount();

  const { writeContractAsync, data: lastTxHash, isPending: isPublishing, error: publishError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: lastTxHash,
  });

  const [recipientInput, setRecipientInput] = useState('');
  const [message, setMessage] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastCapsuleHex, setLastCapsuleHex] = useState<Hex | null>(null);

  const { data: dropCount, refetch: refetchDropCount } = useReadContract({
    address: registry.registryAddress,
    abi: DEAD_DROP_REGISTRY_ABI,
    functionName: 'getDropCount',
    query: { enabled: Boolean(registry.registryAddress) },
  });

  const recentRange = useMemo(() => {
    const total = (dropCount ?? 0n) as bigint;
    const count = total > 10n ? 10n : total;
    const start = total > 10n ? total - 10n : 0n;
    return { start, count, total };
  }, [dropCount]);

  const { data: recentDrops, refetch: refetchRecentDrops } = useReadContract({
    address: registry.registryAddress,
    abi: DEAD_DROP_REGISTRY_ABI,
    functionName: 'getDropsRange',
    args: [recentRange.start, recentRange.count],
    query: { enabled: Boolean(registry.registryAddress) && recentRange.count > 0n },
  });

  useEffect(() => {
    if (!isConfirmed) return;
    void refetchDropCount();
    void refetchRecentDrops();
  }, [isConfirmed, lastTxHash, refetchDropCount, refetchRecentDrops]);

  async function onCreateDrop(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setLastCapsuleHex(null);

    if (!isConnected || !activeAddress) {
      setCreateError('Connect a wallet to publish.');
      return;
    }
    if (!registry.registryAddress) {
      setCreateError('Set the registry contract address (top right) for this chain first.');
      return;
    }
    if (!publicClient) {
      setCreateError('No public client available for this chain.');
      return;
    }

    let recipient: Address;
    try {
      recipient = parseRecipientAddress(recipientInput.trim());
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'invalid recipient');
      return;
    }

    const msg = message.trim();
    if (!msg) {
      setCreateError('Message is empty.');
      return;
    }
    if (msg.length > MAX_MESSAGE_CHARS) {
      setCreateError(`Message too long (max ${MAX_MESSAGE_CHARS} chars).`);
      return;
    }

    try {
      setProgress('1/3 Locating recipient pubkey via their latest outgoing tx…');
      const recipientPubkey = await getRecipientPublicKey({
        publicClient,
        chainId: registry.chainId,
        recipientAddress: recipient,
      });

      setProgress('2/3 Encrypting message…');
      const { capsule } = encryptMessageV1({ recipientPubkey, message: msg });
      const capsuleHex = bytesToHex(capsule);
      setLastCapsuleHex(capsuleHex);

      setProgress('3/3 Publishing drop on-chain…');
      await writeContractAsync({
        address: registry.registryAddress,
        abi: DEAD_DROP_REGISTRY_ABI,
        functionName: 'createDrop',
        args: [recipient, capsuleHex],
      });

      setProgress(null);
      setRecipientInput('');
      setMessage('');
    } catch (err) {
      setProgress(null);
      setCreateError(err instanceof Error ? err.message : 'failed to create drop');
    }
  }

  const recentRows = useMemo(() => {
    const drops = (recentDrops ?? []) as Array<{
      sender: Address;
      recipient: Address;
      blockNumber: bigint;
      timestamp: bigint;
      capsule: Hex;
    }>;

    return drops
      .map((d, i) => ({
        dropId: recentRange.start + BigInt(i),
        ...d,
      }))
      .reverse();
  }, [recentDrops, recentRange.start]);

  const capsulePreview = useMemo(() => {
    if (!lastCapsuleHex) return null;
    try {
      const decoded = decodeCapsuleV1(hexToBytes(lastCapsuleHex));
      return {
        version: decoded.version,
        ephPub: bytesToHex(decoded.ephemeralPubkeyCompressed),
        salt: bytesToHex(decoded.salt),
        nonce: bytesToHex(decoded.nonce),
        ciphertextBytes: decoded.ciphertext.length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'invalid capsule' } as const;
    }
  }, [lastCapsuleHex]);

  return (
    <div className="stack">
      <section className="hero">
        <h1>DeadDrop Protocol (DDRP)</h1>
        <p className="lead">
          A tiny demo dapp for posting encrypted “drops” to a recipient EOA — and a gentle nudge toward EIP-5630
          (wallet-assisted ECDH).
        </p>
      </section>

      <section className="card">
        <h2>Create Drop</h2>
        <p className="muted">
          v1 uses <strong>secp256k1 ECDH</strong> with an <strong>ephemeral sender key</strong>. To encrypt to an address,
          we first try to recover the recipient’s public key from their latest outgoing transaction signature.
        </p>

        <form className="form" onSubmit={onCreateDrop}>
          <label className="label">
            Recipient (EOA)
            <input
              className="input"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              inputMode="text"
              autoComplete="off"
            />
          </label>

          <label className="label">
            Plaintext message (encrypted client-side)
            <textarea
              className="textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hello from DDRP…"
              maxLength={MAX_MESSAGE_CHARS}
              rows={5}
            />
            <div className="helper">
              <span className="muted">
                {message.length}/{MAX_MESSAGE_CHARS} chars
              </span>
            </div>
          </label>

          <button className="btn" type="submit" disabled={!isConnected || isPublishing || isConfirming}>
            {isPublishing ? 'Publishing…' : isConfirming ? 'Confirming…' : 'Encrypt & Publish'}
          </button>

          {progress ? <div className="notice">{progress}</div> : null}
          {createError ? <div className="error">{createError}</div> : null}
          {publishError ? <div className="error">{publishError.message}</div> : null}
          {lastTxHash ? (
            <div className="notice">
              Tx submitted: <code>{truncateHex(lastTxHash)}</code> {isConfirmed ? '✅ confirmed' : '⏳ pending'}
            </div>
          ) : null}

          {capsulePreview ? (
            <div className="subcard">
              <div className="muted">Last capsule (client-side preview)</div>
              {'error' in capsulePreview ? (
                <div className="error">{capsulePreview.error}</div>
              ) : (
                <ul className="monoList">
                  <li>
                    version: <code>{capsulePreview.version}</code>
                  </li>
                  <li>
                    ephemeralPubkey: <code>{truncateHex(capsulePreview.ephPub as Hex)}</code>
                  </li>
                  <li>
                    salt: <code>{truncateHex(capsulePreview.salt as Hex)}</code>
                  </li>
                  <li>
                    nonce: <code>{truncateHex(capsulePreview.nonce as Hex)}</code>
                  </li>
                  <li>
                    ciphertext+tag bytes: <code>{capsulePreview.ciphertextBytes}</code>
                  </li>
                </ul>
              )}
            </div>
          ) : null}
        </form>
      </section>

      <section className="card">
        <div className="row between center">
          <h2>Recent Drops (10)</h2>
          <Link className="linkBtn" to="/drops">
            View all drops →
          </Link>
        </div>

        {!registry.registryAddress ? (
          <div className="warn">Set the registry address to load drops.</div>
        ) : recentRows.length === 0 ? (
          <div className="muted">No drops yet.</div>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Sender</th>
                  <th>Recipient</th>
                  <th>Drop</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((row) => (
                  <tr key={row.dropId.toString()}>
                    <td className="nowrap">{formatTimestampSeconds(row.timestamp)}</td>
                    <td>
                      <AddressChip address={row.sender} />
                    </td>
                    <td>
                      <AddressChip address={row.recipient} />
                    </td>
                    <td className="nowrap">
                      <Link to={`/drops/${row.dropId.toString()}`}>#{row.dropId.toString()}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Why EIP-5630?</h2>
        <ul className="bullets">
          <li>
            <strong>What it enables:</strong> wallet-assisted secp256k1 ECDH so dapps can encrypt/decrypt without ever
            seeing private keys.
          </li>
          <li>
            <strong>What’s missing today:</strong> most wallets don’t expose a standard ECDH RPC yet, so dapps resort to
            unsafe key entry or brittle pubkey recovery tricks.
          </li>
          <li>
            <strong>How you can help:</strong> implement/support the proposed RPC methods (e.g. <code>eth_performECDH</code>
            ) in wallets and tooling, and give feedback on the EIP.
          </li>
        </ul>
        <p className="muted">
          In this demo, the drop format stays constant — the decrypt method can vary (wallet ECDH, manual key entry,
          future Snap), as long as it can do secp256k1 ECDH.
        </p>
      </section>
    </div>
  );
}
