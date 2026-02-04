import { useEffect, useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { bytesToHex, hexToBytes, parseAbiItem } from 'viem';
import { Link, useParams } from 'react-router-dom';
import { useAccount, usePublicClient, useReadContract, useWalletClient } from 'wagmi';

import { decodeCapsuleV1, decryptMessageV1, decryptMessageV1FromSharedSecret } from '../ddrp/capsuleV1';
import { useRegistryConfig } from '../ddrp/registryConfig';
import { clearDecryptedPlaintext, getDecryptedPlaintext, setDecryptedPlaintext } from '../ddrp/decryptedStore';
import { DEAD_DROP_REGISTRY_ABI, blockExplorerTxUrl } from '../ddrp/registry';
import { AddressChip } from '../components/AddressChip';

const DROP_CREATED_EVENT = parseAbiItem(
  'event DropCreated(uint256 indexed dropId, address indexed sender, address indexed recipient, uint64 blockNumber, uint64 timestamp, bytes capsule)',
);

type Eip1193Requester = Readonly<{
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
}>;

function formatTimestampSeconds(seconds: bigint): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return seconds.toString();
  return new Date(ms).toLocaleString();
}

function truncateHex(value: Hex, start = 10, end = 8): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function parsePrivateKey(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed.startsWith('0x')) throw new Error('private key must start with 0x');
  const bytes = hexToBytes(trimmed as Hex);
  if (bytes.length !== 32) throw new Error('private key must be 32 bytes');
  return bytes;
}

export function DropPage() {
  const { id } = useParams();
  const registry = useRegistryConfig();
  const publicClient = usePublicClient();
  const { address: activeAddress, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const dropId = useMemo(() => {
    if (!id) return null;
    if (!/^\d+$/.test(id)) return null;
    try {
      return BigInt(id);
    } catch {
      return null;
    }
  }, [id]);

  const { data: drop, error: dropError } = useReadContract({
    address: registry.registryAddress,
    abi: DEAD_DROP_REGISTRY_ABI,
    functionName: 'getDrop',
    args: dropId !== null ? [dropId] : undefined,
    query: { enabled: Boolean(registry.registryAddress) && dropId !== null },
  });

  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txLookupError, setTxLookupError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setTxHash(null);
      setTxLookupError(null);

      if (!publicClient || !registry.registryAddress || dropId === null || !drop) return;
      const d = drop as { blockNumber: bigint };
      try {
        const logs = await publicClient.getLogs({
          address: registry.registryAddress,
          event: DROP_CREATED_EVENT,
          args: { dropId },
          fromBlock: d.blockNumber,
          toBlock: d.blockNumber,
          strict: true,
        });
        if (cancelled) return;
        if (logs.length === 0) throw new Error('event log not found in drop block');
        setTxHash(logs[0]!.transactionHash);
      } catch (err) {
        if (cancelled) return;
        setTxLookupError(err instanceof Error ? err.message : 'failed to look up tx');
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [publicClient, registry.registryAddress, dropId, drop]);

  const decodedCapsule = useMemo(() => {
    if (!drop) return null;
    const d = drop as { capsule: Hex };
    try {
      const decoded = decodeCapsuleV1(hexToBytes(d.capsule));
      return {
        ok: true as const,
        version: decoded.version,
        ephPub: bytesToHex(decoded.ephemeralPubkeyCompressed),
        salt: bytesToHex(decoded.salt),
        nonce: bytesToHex(decoded.nonce),
        ciphertext: bytesToHex(decoded.ciphertext),
        ciphertextBytes: decoded.ciphertext.length,
        capsuleBytes: hexToBytes(d.capsule).length,
      };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'failed to decode capsule' };
    }
  }, [drop]);

  const existingPlaintext = useMemo(() => {
    if (!registry.registryAddress || dropId === null) return undefined;
    return getDecryptedPlaintext({ chainId: registry.chainId, registryAddress: registry.registryAddress, dropId });
  }, [registry.chainId, registry.registryAddress, dropId]);

  const [manualPrivKey, setManualPrivKey] = useState('');
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [isWalletDecrypting, setIsWalletDecrypting] = useState(false);

  useEffect(() => {
    setPlaintext(existingPlaintext ?? null);
  }, [existingPlaintext]);

  function forgetDecryption() {
    if (!registry.registryAddress || dropId === null) return;
    clearDecryptedPlaintext({ chainId: registry.chainId, registryAddress: registry.registryAddress, dropId });
    setPlaintext(null);
  }

  async function manualDecrypt() {
    setDecryptError(null);
    setIsWalletDecrypting(false);

    if (!drop) {
      setDecryptError('Drop not loaded.');
      return;
    }
    if (!registry.registryAddress || dropId === null) {
      setDecryptError('Registry not configured.');
      return;
    }

    try {
      const privKeyBytes = parsePrivateKey(manualPrivKey);
      const d = drop as { capsule: Hex };
      const pt = decryptMessageV1({ capsule: hexToBytes(d.capsule), recipientPrivateKey: privKeyBytes });
      setPlaintext(pt);
      setDecryptedPlaintext({
        chainId: registry.chainId,
        registryAddress: registry.registryAddress,
        dropId,
        plaintext: pt,
      });
    } catch (err) {
      setDecryptError(err instanceof Error ? err.message : 'failed to decrypt');
    }
  }

  async function walletEcdhDecrypt() {
    setDecryptError(null);
    if (!drop) {
      setDecryptError('Drop not loaded.');
      return;
    }
    if (!registry.registryAddress || dropId === null) {
      setDecryptError('Registry not configured.');
      return;
    }
    if (!isConnected || !activeAddress) {
      setDecryptError('Connect a wallet first.');
      return;
    }
    if (!walletClient) {
      setDecryptError('Wallet client not available.');
      return;
    }

    const d = drop as { recipient: Address; capsule: Hex };
    if (d.recipient.toLowerCase() !== activeAddress.toLowerCase()) {
      setDecryptError('Wallet ECDH only works when the connected wallet is the drop recipient.');
      return;
    }

    try {
      setIsWalletDecrypting(true);
      const capsuleBytes = hexToBytes(d.capsule);
      const decoded = decodeCapsuleV1(capsuleBytes);
      const ephPub = bytesToHex(decoded.ephemeralPubkeyCompressed);

      // EIP-5630 draft: `eth_performECDH` => 32-byte shared secret (x-coordinate).
      const provider = walletClient as unknown as Eip1193Requester;
      const sharedSecretHex = (await provider.request({
        method: 'eth_performECDH',
        params: [activeAddress, ephPub],
      })) as Hex;

      const pt = decryptMessageV1FromSharedSecret({
        capsule: capsuleBytes,
        sharedSecret: hexToBytes(sharedSecretHex),
      });

      setPlaintext(pt);
      setDecryptedPlaintext({
        chainId: registry.chainId,
        registryAddress: registry.registryAddress,
        dropId,
        plaintext: pt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'wallet decrypt failed';
      if (msg.includes('Method not found') || msg.includes('-32601')) {
        setDecryptError('This wallet does not support EIP-5630 yet (eth_performECDH unavailable).');
      } else {
        setDecryptError(msg);
      }
    } finally {
      setIsWalletDecrypting(false);
    }
  }

  if (!registry.registryAddress) {
    return (
      <section className="card">
        <div className="row between center">
          <h2>Drop</h2>
          <Link className="linkBtn" to="/drops">
            ← All drops
          </Link>
        </div>
        <div className="warn">Set the registry address to load drops.</div>
      </section>
    );
  }

  if (dropId === null) {
    return (
      <section className="card">
        <div className="row between center">
          <h2>Drop</h2>
          <Link className="linkBtn" to="/drops">
            ← All drops
          </Link>
        </div>
        <div className="error">Invalid drop id.</div>
      </section>
    );
  }

  const d = drop as
    | undefined
    | {
        sender: Address;
        recipient: Address;
        blockNumber: bigint;
        timestamp: bigint;
        capsule: Hex;
      };

  return (
    <div className="stack">
      <section className="card">
        <div className="row between center">
          <h2>Drop #{dropId.toString()}</h2>
          <Link className="linkBtn" to="/drops">
            ← All drops
          </Link>
        </div>

        {dropError ? <div className="error">{dropError.message}</div> : null}
        {!d ? (
          <div className="muted">Loading drop…</div>
        ) : (
          <div className="stack">
            <div className="grid2">
              <div className="subcard">
                <div className="muted">Sender</div>
                <AddressChip address={d.sender} />
              </div>
              <div className="subcard">
                <div className="muted">Recipient</div>
                <AddressChip address={d.recipient} />
              </div>
            </div>

            <div className="grid2">
              <div className="subcard">
                <div className="muted">Timestamp</div>
                <div className="nowrap">{formatTimestampSeconds(d.timestamp)}</div>
              </div>
              <div className="subcard">
                <div className="muted">Block</div>
                <code>{d.blockNumber.toString()}</code>
              </div>
            </div>

            <div className="subcard">
              <div className="muted">Transaction</div>
              {txHash ? (
                <div className="row between center">
                  <code className="nowrap">{txHash}</code>
                  {blockExplorerTxUrl(registry.chainId, txHash) ? (
                    <a className="linkBtn" href={blockExplorerTxUrl(registry.chainId, txHash)} target="_blank" rel="noreferrer">
                      View on explorer →
                    </a>
                  ) : null}
                </div>
              ) : txLookupError ? (
                <div className="warn">{txLookupError}</div>
              ) : (
                <div className="muted">Looking up…</div>
              )}
            </div>

            <div className="subcard">
              <div className="row between center">
                <div>
                  <div className="muted">Capsule bytes</div>
                  <code>{hexToBytes(d.capsule).length}</code>
                </div>
                <button className="btn btnGhost" type="button" onClick={() => navigator.clipboard.writeText(d.capsule)}>
                  Copy capsule hex
                </button>
              </div>
              <div className="monoSmall">
                <code>{truncateHex(d.capsule)}</code>
              </div>
            </div>

            <div className="subcard">
              <div className="muted">Capsule fields (v1)</div>
              {!decodedCapsule ? null : decodedCapsule.ok ? (
                <ul className="monoList">
                  <li>
                    version: <code>{decodedCapsule.version}</code>
                  </li>
                  <li>
                    ephemeral pubkey (compressed): <code>{decodedCapsule.ephPub}</code>
                  </li>
                  <li>
                    salt: <code>{decodedCapsule.salt}</code>
                  </li>
                  <li>
                    nonce: <code>{decodedCapsule.nonce}</code>
                  </li>
                  <li>
                    ciphertext+tag bytes: <code>{decodedCapsule.ciphertextBytes}</code>
                  </li>
                </ul>
              ) : (
                <div className="warn">{decodedCapsule.error}</div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Decrypt</h2>

        {plaintext ? (
          <div className="subcard">
            <div className="row between center">
              <div className="muted">Plaintext (stored locally)</div>
              <button className="btn btnGhost" type="button" onClick={forgetDecryption}>
                Forget
              </button>
            </div>
            <pre className="plaintext">{plaintext}</pre>
          </div>
        ) : (
          <div className="muted">No local decryption yet.</div>
        )}

        <div className="grid2">
          <div className="subcard">
            <div className="row between center">
              <h3 className="h3">Try wallet ECDH (EIP-5630)</h3>
              <span className="badge">Aspirational</span>
            </div>
            <p className="muted">
              Calls <code>eth_performECDH</code> on your wallet to derive the ECDH shared secret without exposing keys.
              Not widely supported yet.
            </p>
            <button className="btn btnSecondary" type="button" onClick={walletEcdhDecrypt} disabled={isWalletDecrypting || !walletClient}>
              {isWalletDecrypting ? 'Decrypting…' : 'Decrypt with wallet'}
            </button>
          </div>

          <div className="subcard">
            <div className="row between center">
              <h3 className="h3">Manual decrypt (unsafe)</h3>
              <span className="badge warn">Do not use main keys</span>
            </div>
            <p className="warn">
              This is a gross fallback. Never paste a real wallet’s private key/seed phrase. Use a throwaway dev account.
            </p>
            <label className="label">
              Recipient private key (hex)
              <input
                className="input"
                value={manualPrivKey}
                onChange={(e) => setManualPrivKey(e.target.value)}
                placeholder="0x… (32 bytes)"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>
            <button className="btn btnSecondary" type="button" onClick={manualDecrypt} disabled={!manualPrivKey.trim().startsWith('0x')}>
              Decrypt locally
            </button>
          </div>
        </div>

        <div className="subcard">
          <div className="row between center">
            <h3 className="h3">Snap-based decrypt</h3>
            <span className="badge">Placeholder</span>
          </div>
          <p className="muted">
            Planned hook: MetaMask Snap that performs secp256k1 ECDH and returns the shared secret (or directly decrypts)
            without leaking keys.
          </p>
          <button className="btn btnGhost" type="button" disabled>
            Coming soon
          </button>
        </div>

        {decryptError ? <div className="error">{decryptError}</div> : null}
        {!isConnected && walletClient ? <div className="warn">Connect wallet to try EIP-5630 decrypt.</div> : null}
      </section>
    </div>
  );
}
