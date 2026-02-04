import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Hex } from 'viem';
import { bytesToHex, hexToBytes } from 'viem';

import { decodeCapsuleV1, decryptMessageV1FromSharedSecret, encryptMessageV1 } from '../ddrp/capsuleV1';

const DEFAULT_SNAP_ID = 'local:http://localhost:8081';

type Eip1193Provider = Readonly<{
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}>;

type InstalledSnap = Readonly<{
  id: string;
  version: string;
}>;

function getInjectedProvider(): Eip1193Provider | null {
  const maybe = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!maybe || typeof maybe !== 'object') return null;
  const provider = maybe as { request?: unknown };
  if (typeof provider.request !== 'function') return null;
  return provider as unknown as Eip1193Provider;
}

function normalizeSnaps(result: unknown): InstalledSnap[] {
  if (Array.isArray(result)) {
    return result
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        const snap = s as { id?: unknown; version?: unknown };
        if (typeof snap.id !== 'string' || typeof snap.version !== 'string') return null;
        return { id: snap.id, version: snap.version };
      })
      .filter((s): s is InstalledSnap => Boolean(s));
  }

  if (result && typeof result === 'object') {
    return Object.entries(result as Record<string, unknown>)
      .map(([id, value]) => {
        if (!value || typeof value !== 'object') return null;
        const snap = value as { version?: unknown };
        if (typeof snap.version !== 'string') return null;
        return { id, version: snap.version };
      })
      .filter((s): s is InstalledSnap => Boolean(s));
  }

  return [];
}

async function isFlask(provider: Eip1193Provider): Promise<boolean> {
  try {
    const version = await provider.request({ method: 'web3_clientVersion' });
    return typeof version === 'string' && version.toLowerCase().includes('flask');
  } catch {
    return false;
  }
}

async function getInstalledSnaps(provider: Eip1193Provider): Promise<InstalledSnap[]> {
  const res = await provider.request({ method: 'wallet_getSnaps' });
  return normalizeSnaps(res);
}

async function requestSnap(provider: Eip1193Provider, snapId: string): Promise<void> {
  await provider.request({
    method: 'wallet_requestSnaps',
    params: { [snapId]: {} },
  });
}

async function invokeSnap<T>(provider: Eip1193Provider, snapId: string, request: { method: string; params?: unknown }): Promise<T> {
  return (await provider.request({
    method: 'wallet_invokeSnap',
    params: { snapId, request },
  })) as T;
}

export function SnapPage() {
  const provider = useMemo(getInjectedProvider, []);
  const [snapId, setSnapId] = useState(DEFAULT_SNAP_ID);

  const [isProviderReady, setIsProviderReady] = useState<boolean>(Boolean(provider));
  const [isFlaskWallet, setIsFlaskWallet] = useState<boolean | null>(null);
  const [snaps, setSnaps] = useState<InstalledSnap[]>([]);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const [pubkeyHex, setPubkeyHex] = useState<Hex | null>(null);
  const [message, setMessage] = useState('hello from DDRP snap');
  const [capsuleHex, setCapsuleHex] = useState<Hex | null>(null);
  const [sharedSecretHex, setSharedSecretHex] = useState<Hex | null>(null);
  const [decrypted, setDecrypted] = useState<string | null>(null);

  const installedSnap = useMemo(() => snaps.find((s) => s.id === snapId) ?? null, [snaps, snapId]);

  const decodedCapsule = useMemo(() => {
    if (!capsuleHex) return null;
    try {
      const decoded = decodeCapsuleV1(hexToBytes(capsuleHex));
      return {
        ephPubkey: bytesToHex(decoded.ephemeralPubkeyCompressed),
        salt: bytesToHex(decoded.salt),
        nonce: bytesToHex(decoded.nonce),
        ciphertextBytes: decoded.ciphertext.length,
        capsuleBytes: hexToBytes(capsuleHex).length,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'failed to decode capsule' } as const;
    }
  }, [capsuleHex]);

  const refreshSnaps = useCallback(async () => {
    setSnapError(null);
    setIsRefreshing(true);
    setSnaps([]);
    try {
      if (!provider) throw new Error('No injected wallet provider found.');
      const installed = await getInstalledSnaps(provider);
      setSnaps(installed);
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : 'Failed to load snaps.');
    } finally {
      setIsRefreshing(false);
    }
  }, [provider]);

  useEffect(() => {
    setIsProviderReady(Boolean(provider));
    if (!provider) return;
    let cancelled = false;
    void (async () => {
      const flask = await isFlask(provider);
      if (cancelled) return;
      setIsFlaskWallet(flask);
      await refreshSnaps();
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, refreshSnaps]);

  async function installSnap() {
    setSnapError(null);
    setIsInstalling(true);
    try {
      if (!provider) throw new Error('No injected wallet provider found.');
      await requestSnap(provider, snapId);
      await refreshSnaps();
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : 'Failed to install snap.');
    } finally {
      setIsInstalling(false);
    }
  }

  async function fetchPubkey() {
    setSnapError(null);
    setPubkeyHex(null);
    setSharedSecretHex(null);
    setDecrypted(null);

    try {
      if (!provider) throw new Error('No injected wallet provider found.');
      const pk = await invokeSnap<Hex>(provider, snapId, { method: 'ddrp_getEncryptionPublicKey' });
      setPubkeyHex(pk);
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : 'Failed to request pubkey.');
    }
  }

  async function encryptLocal() {
    setSnapError(null);
    setCapsuleHex(null);
    setSharedSecretHex(null);
    setDecrypted(null);

    try {
      if (!pubkeyHex) throw new Error('Fetch the snap public key first.');
      const { capsule } = encryptMessageV1({ recipientPubkey: hexToBytes(pubkeyHex), message });
      setCapsuleHex(bytesToHex(capsule));
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : 'Failed to encrypt.');
    }
  }

  async function deriveSharedSecret() {
    setSnapError(null);
    setSharedSecretHex(null);
    setDecrypted(null);

    try {
      if (!provider) throw new Error('No injected wallet provider found.');
      if (!decodedCapsule || 'error' in decodedCapsule) throw new Error('No valid capsule available.');

      const shared = await invokeSnap<Hex>(provider, snapId, {
        method: 'ddrp_performECDH',
        params: { ephemeralPubkey: decodedCapsule.ephPubkey },
      });
      setSharedSecretHex(shared);
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : 'Failed to derive shared secret.');
    }
  }

  async function decryptLocal() {
    setSnapError(null);
    setDecrypted(null);

    try {
      if (!capsuleHex) throw new Error('No capsule available.');
      if (!sharedSecretHex) throw new Error('No shared secret available.');
      const pt = decryptMessageV1FromSharedSecret({
        capsule: hexToBytes(capsuleHex),
        sharedSecret: hexToBytes(sharedSecretHex),
      });
      setDecrypted(pt);
    } catch (err) {
      setSnapError(err instanceof Error ? err.message : 'Failed to decrypt.');
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>MetaMask Snap (experimental)</h2>
        <p className="muted">
          This page is a local-dev playground for a DDRP Snap. It demonstrates the EIP-5630-style flow (wallet does ECDH
          and returns a 32-byte shared secret), but uses a snap-derived key (<code>snap_getEntropy</code>), not your normal
          MetaMask EOA key.
        </p>

        <div className="grid2">
          <div className="subcard">
            <div className="muted">Wallet</div>
            <ul>
              <li>
                injected provider: <code>{isProviderReady ? 'yes' : 'no'}</code>
              </li>
              <li>
                MetaMask Flask: <code>{isFlaskWallet === null ? 'checking…' : isFlaskWallet ? 'yes' : 'no'}</code>
              </li>
            </ul>
            <div className="row">
              <button className="btn btnGhost" type="button" onClick={refreshSnaps} disabled={!provider || isRefreshing}>
                {isRefreshing ? 'Refreshing…' : 'Refresh snaps'}
              </button>
            </div>
          </div>

          <div className="subcard">
            <div className="muted">Snap</div>
            <label className="label">
              Snap ID
              <input className="input" value={snapId} onChange={(e) => setSnapId(e.target.value)} spellCheck={false} />
            </label>
            <div className="row">
              <button className="btn btnSecondary" type="button" onClick={installSnap} disabled={!provider || isInstalling}>
                {isInstalling ? 'Installing…' : 'Install / update'}
              </button>
            </div>
            <div className="muted">
              installed: <code>{installedSnap ? `${installedSnap.version}` : 'no'}</code>
            </div>
          </div>
        </div>

        {snapError ? <div className="error">{snapError}</div> : null}
      </section>

      <section className="card">
        <h2>ECDH round-trip demo</h2>
        <p className="muted">
          Flow: get snap pubkey → encrypt locally → ask snap to perform ECDH → decrypt locally (XChaCha20-Poly1305).
        </p>

        <div className="inline">
          <button className="btn btnSecondary" type="button" onClick={fetchPubkey} disabled={!provider || !installedSnap}>
            Get snap pubkey
          </button>
          <button className="btn btnSecondary" type="button" onClick={encryptLocal} disabled={!pubkeyHex}>
            Encrypt locally
          </button>
          <button className="btn btnSecondary" type="button" onClick={deriveSharedSecret} disabled={!capsuleHex || !installedSnap}>
            Derive shared secret (snap)
          </button>
          <button className="btn btnSecondary" type="button" onClick={decryptLocal} disabled={!capsuleHex || !sharedSecretHex}>
            Decrypt locally
          </button>
        </div>

        <div className="grid2">
          <div className="subcard">
            <div className="muted">Snap public key (compressed)</div>
            {pubkeyHex ? (
              <div className="monoSmall">
                <code>{pubkeyHex}</code>
              </div>
            ) : (
              <div className="muted">Not fetched.</div>
            )}
          </div>

          <div className="subcard">
            <div className="muted">Shared secret (32-byte x-coordinate)</div>
            {sharedSecretHex ? (
              <div className="monoSmall">
                <code>{sharedSecretHex}</code>
              </div>
            ) : (
              <div className="muted">Not derived.</div>
            )}
          </div>
        </div>

        <label className="label">
          Message
          <textarea className="input" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
        </label>

        <div className="subcard">
          <div className="muted">Capsule</div>
          {capsuleHex ? (
            <>
              <div className="monoSmall">
                <code>{capsuleHex}</code>
              </div>
              {decodedCapsule && 'error' in decodedCapsule ? <div className="warn">{decodedCapsule.error}</div> : null}
              {decodedCapsule && !('error' in decodedCapsule) ? (
                <ul className="monoList">
                  <li>
                    ephemeral pubkey: <code>{decodedCapsule.ephPubkey}</code>
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
                  <li>
                    capsule bytes: <code>{decodedCapsule.capsuleBytes}</code>
                  </li>
                </ul>
              ) : null}
            </>
          ) : (
            <div className="muted">Not encrypted yet.</div>
          )}
        </div>

        <div className="subcard">
          <div className="muted">Decrypted plaintext</div>
          {decrypted ? <pre className="plaintext">{decrypted}</pre> : <div className="muted">Not decrypted yet.</div>}
        </div>
      </section>
    </div>
  );
}
