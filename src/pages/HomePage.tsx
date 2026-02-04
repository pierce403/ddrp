import { useEffect, useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { bytesToHex, getAddress, hexToBytes, isAddress } from 'viem';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { decodeCapsuleV1, encryptMessageV1 } from '../ddrp/capsuleV1';
import { useRegistryConfig } from '../ddrp/registryConfig';
import { getRecipientPublicKey } from '../ddrp/pubkeyDiscovery';
import { DEAD_DROP_REGISTRY_ABI, etherscanTxUrl } from '../ddrp/registry';
import { AddressChip } from '../components/AddressChip';

const MAX_MESSAGE_CHARS = 500;
const RECIPIENT_PREFLIGHT_DEBOUNCE_MS = 450;

function formatTimestampSeconds(seconds: bigint): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return seconds.toString();
  return new Date(ms).toLocaleString();
}

function truncateHex(value: Hex, start = 10, end = 8): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

type RecipientPreflight =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'invalid'; input: string; message: string }>
  | Readonly<{ kind: 'resolving'; input: string; message: string }>
  | Readonly<{
      kind: 'checking';
      input: string;
      chainId: number;
      recipient: Address;
      checksumNote?: string;
      resolvedFromEns?: string;
    }>
  | Readonly<{
      kind: 'live';
      input: string;
      chainId: number;
      recipient: Address;
      pubkey: Uint8Array;
      checksumNote?: string;
      resolvedFromEns?: string;
    }>
  | Readonly<{
      kind: 'notLive';
      input: string;
      chainId: number;
      recipient: Address;
      reason: string;
      checksumNote?: string;
      resolvedFromEns?: string;
    }>
  | Readonly<{
      kind: 'error';
      input: string;
      chainId: number;
      recipient?: Address;
      message: string;
      checksumNote?: string;
      resolvedFromEns?: string;
    }>;

function isMixedCaseHex(value: string): boolean {
  const body = value.startsWith('0x') ? value.slice(2) : value;
  return body !== body.toLowerCase() && body !== body.toUpperCase();
}

async function resolveRecipientInput(args: {
  input: string;
  mainnetClient: ReturnType<typeof usePublicClient>;
}): Promise<Readonly<{ recipient: Address; checksumNote?: string; resolvedFromEns?: string }>> {
  const value = args.input.trim();
  if (!value) throw new Error('Recipient is empty.');

  if (isAddress(value)) {
    const normalized = getAddress(value);
    const checksumNote =
      normalized !== value ? `Address is valid but not checksummed. Using ${normalized}.` : undefined;
    return { recipient: normalized, checksumNote };
  }

  if (value.startsWith('0x')) {
    const lower = value.toLowerCase();
    if (isMixedCaseHex(value) && isAddress(lower)) {
      const expected = getAddress(lower);
      throw new Error(`Checksum mismatch. Expected ${expected}.`);
    }
    throw new Error('Invalid address.');
  }

  if (!value.includes('.')) throw new Error('Enter a 0x address or an ENS name (e.g. vitalik.eth).');
  if (!args.mainnetClient) throw new Error('ENS resolution unavailable (no mainnet RPC client).');

  const ensAddress = await args.mainnetClient.getEnsAddress({ name: value });
  if (!ensAddress) throw new Error(`ENS name did not resolve: ${value}`);
  return { recipient: getAddress(ensAddress), resolvedFromEns: value };
}

export function HomePage() {
  const registry = useRegistryConfig();
  const publicClient = usePublicClient();
  const mainnetClient = usePublicClient({ chainId: 1 });
  const { address: activeAddress, isConnected } = useAccount();

  const { writeContractAsync, data: lastTxHash, isPending: isPublishing, error: publishError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: lastTxHash,
  });

  const [recipientInput, setRecipientInput] = useState('');
  const [recipientPreflight, setRecipientPreflight] = useState<RecipientPreflight>({ kind: 'idle' });
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

  useEffect(() => {
    const trimmed = recipientInput.trim();
    if (!trimmed) {
      setRecipientPreflight({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    const currentChainId = registry.chainId;

    let baseResolved:
      | Readonly<{ recipient: Address; checksumNote?: string; resolvedFromEns?: string }>
      | null = null;

    if (isAddress(trimmed)) {
      const normalized = getAddress(trimmed);
      baseResolved = {
        recipient: normalized,
        checksumNote:
          normalized !== trimmed ? `Address is valid but not checksummed. Using ${normalized}.` : undefined,
      };

      setRecipientPreflight({
        kind: 'checking',
        input: trimmed,
        chainId: currentChainId,
        recipient: normalized,
        checksumNote: baseResolved.checksumNote,
      });
    } else if (trimmed.startsWith('0x')) {
      const lower = trimmed.toLowerCase();
      if (isMixedCaseHex(trimmed) && isAddress(lower)) {
        const expected = getAddress(lower);
        setRecipientPreflight({ kind: 'invalid', input: trimmed, message: `Checksum mismatch. Expected ${expected}.` });
      } else {
        setRecipientPreflight({ kind: 'invalid', input: trimmed, message: 'Invalid address.' });
      }
      return;
    } else if (!trimmed.includes('.')) {
      setRecipientPreflight({
        kind: 'invalid',
        input: trimmed,
        message: 'Enter a 0x address or an ENS name (e.g. vitalik.eth).',
      });
      return;
    } else {
      setRecipientPreflight({ kind: 'resolving', input: trimmed, message: 'Resolving ENS…' });
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        let resolved:
          | Readonly<{ recipient: Address; checksumNote?: string; resolvedFromEns?: string }>
          | null = baseResolved;
        try {
          if (!publicClient) {
            setRecipientPreflight({
              kind: 'error',
              input: trimmed,
              chainId: currentChainId,
              message: 'No public client available for this chain.',
            });
            return;
          }

          resolved =
            resolved ??
            (await resolveRecipientInput({
              input: trimmed,
              mainnetClient,
            }));

          if (cancelled) return;

          setRecipientPreflight({
            kind: 'checking',
            input: trimmed,
            chainId: currentChainId,
            recipient: resolved.recipient,
            checksumNote: resolved.checksumNote,
            resolvedFromEns: resolved.resolvedFromEns,
          });

          const pubkey = await getRecipientPublicKey({
            publicClient,
            chainId: currentChainId,
            recipientAddress: resolved.recipient,
          });

          if (cancelled) return;

          setRecipientPreflight({
            kind: 'live',
            input: trimmed,
            chainId: currentChainId,
            recipient: resolved.recipient,
            pubkey,
            checksumNote: resolved.checksumNote,
            resolvedFromEns: resolved.resolvedFromEns,
          });
        } catch (err) {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : 'Failed to validate recipient.';
          const maybeRecipient = resolved?.recipient;
          if (message.includes('nonce=0') && maybeRecipient) {
            setRecipientPreflight({
              kind: 'notLive',
              input: trimmed,
              chainId: currentChainId,
              recipient: maybeRecipient,
              reason: 'No outgoing tx yet (nonce=0). v1 cannot recover a pubkey for brand-new EOAs.',
              checksumNote: resolved?.checksumNote,
              resolvedFromEns: resolved?.resolvedFromEns,
            });
            return;
          }

          setRecipientPreflight({
            kind: 'error',
            input: trimmed,
            chainId: currentChainId,
            recipient: maybeRecipient,
            message,
            checksumNote: resolved?.checksumNote,
            resolvedFromEns: resolved?.resolvedFromEns,
          });
        }
      })();
    }, RECIPIENT_PREFLIGHT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recipientInput, publicClient, mainnetClient, registry.chainId]);

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

    const trimmedRecipient = recipientInput.trim();

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
      let recipient: Address;
      let recipientPubkey: Uint8Array;

      const canReusePreflight =
        recipientPreflight.kind === 'live' &&
        recipientPreflight.input === trimmedRecipient &&
        recipientPreflight.chainId === registry.chainId;

      if (canReusePreflight) {
        recipient = recipientPreflight.recipient;
        recipientPubkey = recipientPreflight.pubkey;
      } else {
        setProgress('1/3 Resolving recipient + locating pubkey…');
        const resolved = await resolveRecipientInput({ input: trimmedRecipient, mainnetClient });
        recipient = resolved.recipient;
        recipientPubkey = await getRecipientPublicKey({
          publicClient,
          chainId: registry.chainId,
          recipientAddress: recipient,
        });
      }

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
            <div className="row between center">
              <span>Recipient (EOA)</span>
              {recipientPreflight.kind === 'live' ? <span className="badge ok">Live ✓</span> : null}
              {recipientPreflight.kind === 'checking' ? <span className="badge">Checking…</span> : null}
              {recipientPreflight.kind === 'resolving' ? <span className="badge">Resolving…</span> : null}
              {recipientPreflight.kind === 'notLive' ? <span className="badge warn">No outgoing tx</span> : null}
              {recipientPreflight.kind === 'invalid' ? <span className="badge warn">Invalid</span> : null}
              {recipientPreflight.kind === 'error' ? <span className="badge warn">Check failed</span> : null}
            </div>
            <input
              className="input"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              placeholder="0x… or vitalik.eth"
              spellCheck={false}
              inputMode="text"
              autoComplete="off"
            />
            {recipientPreflight.kind === 'checking' ||
            recipientPreflight.kind === 'live' ||
            recipientPreflight.kind === 'notLive' ||
            recipientPreflight.kind === 'error' ? (
              <div className="helper">
                {'resolvedFromEns' in recipientPreflight && recipientPreflight.resolvedFromEns ? (
                  <div>
                    ENS: <code>{recipientPreflight.resolvedFromEns}</code> → <code>{recipientPreflight.recipient}</code>
                  </div>
                ) : null}
                {'checksumNote' in recipientPreflight && recipientPreflight.checksumNote ? (
                  <div>{recipientPreflight.checksumNote}</div>
                ) : null}
                {recipientPreflight.kind === 'notLive' ? <div className="warn">{recipientPreflight.reason}</div> : null}
                {recipientPreflight.kind === 'error' ? <div className="warn">{recipientPreflight.message}</div> : null}
              </div>
            ) : null}
            {recipientPreflight.kind === 'invalid' ? <div className="error">{recipientPreflight.message}</div> : null}
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
              <div className="row between center">
                <span>Tx submitted</span>
                <span className="muted">{isConfirmed ? '✅ confirmed' : '⏳ pending'}</span>
              </div>
              <div className="helper monoSmall">
                <code style={{ overflowWrap: 'anywhere' }}>{lastTxHash}</code>{' '}
                {etherscanTxUrl(registry.chainId, lastTxHash) ? (
                  <a href={etherscanTxUrl(registry.chainId, lastTxHash)} target="_blank" rel="noreferrer">
                    Etherscan →
                  </a>
                ) : null}
              </div>
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
