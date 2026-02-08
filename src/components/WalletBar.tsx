import { useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { getAddress, isAddress } from 'viem';
import {
  useAccount,
  useChainId,
  useChains,
  useConnect,
  useConnections,
  useDeployContract,
  useDisconnect,
  usePublicClient,
  useReconnect,
  useSwitchChain,
} from 'wagmi';

import { useRegistryConfig } from '../ddrp/registryConfig';
import { DEAD_DROP_REGISTRY_ABI, blockExplorerTxUrl } from '../ddrp/registry';
import { DEAD_DROP_REGISTRY_BYTECODE } from '../ddrp/registryBytecode';

function truncateMiddle(value: string, start = 6, end = 4): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function formatWalletChain(chainId: number): string {
  if (chainId === 1) return 'Ethereum Mainnet (1)';
  if (chainId === 8453) return 'Base (8453)';
  if (chainId === 11155111) return 'Sepolia (11155111)';
  if (chainId === 31337) return 'Anvil (31337)';
  return `Chain ${chainId}`;
}

export function WalletBar() {
  const appChainId = useChainId();
  const chains = useChains();
  const { switchChain, switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const registry = useRegistryConfig();
  const publicClient = usePublicClient();

  const { address, chainId: walletChainId, connector: activeConnector, isConnected, status: walletStatus } = useAccount();
  const connections = useConnections();
  const { connectAsync, connectors, isPending: isConnecting, error: connectError, reset: resetConnectError } = useConnect();
  const { disconnect, disconnectAsync, isPending: isDisconnecting } = useDisconnect();
  const { reconnectAsync, isPending: isReconnecting } = useReconnect();
  const { mutateAsync: deployContract, isPending: isDeploying } = useDeployContract();

  const [registryAddressDraftByChain, setRegistryAddressDraftByChain] = useState<Record<number, string>>({});
  const [registryAddressError, setRegistryAddressError] = useState<string | null>(null);
  const [deployNotice, setDeployNotice] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployTxHash, setDeployTxHash] = useState<Hex | null>(null);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const registryAddress = registry.registryAddress;
  const registryAddressInput = registryAddressDraftByChain[appChainId] ?? registryAddress ?? '';

  const currentChain = useMemo(() => chains.find((c) => c.id === appChainId), [chains, appChainId]);
  const isWalletChainMismatch = Boolean(isConnected && walletChainId && walletChainId !== appChainId);
  const walletConnectorName = activeConnector?.name ?? connections[0]?.connector.name ?? null;
  const hasStaleConnection = !isConnected && connections.length > 0;
  const isWalletActionPending = isConnecting || isDisconnecting || isReconnecting;

  async function disconnectAllConnections(): Promise<void> {
    if (connections.length === 0) {
      disconnect();
      return;
    }
    for (const connection of connections) {
      await disconnectAsync({ connector: connection.connector });
    }
  }

  function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  async function onConnect() {
    setWalletError(null);
    setWalletNotice(null);
    resetConnectError();

    const connector = connectors[0];
    if (!connector) {
      setWalletError('No injected wallet connector found.');
      return;
    }

    try {
      await connectAsync({ connector });
      setWalletNotice('Wallet connected.');
      return;
    } catch (error) {
      const message = errorMessage(error, 'Failed to connect wallet.');
      if (!message.toLowerCase().includes('already connected')) {
        setWalletError(message);
        return;
      }
    }

    try {
      setWalletNotice('Connector already active. Restoring wallet session…');
      const restored = await reconnectAsync();
      if (restored.length > 0) {
        setWalletNotice('Wallet session restored.');
        return;
      }
    } catch {
      // fall through to full reset + connect
    }

    try {
      setWalletNotice('Resetting stale wallet session…');
      await disconnectAllConnections();
      await connectAsync({ connector });
      setWalletNotice('Wallet connected.');
    } catch (error) {
      setWalletNotice(null);
      setWalletError(errorMessage(error, 'Failed to recover wallet session.'));
    }
  }

  async function onDisconnectCurrent() {
    setWalletError(null);
    setWalletNotice(null);
    try {
      if (activeConnector) {
        await disconnectAsync({ connector: activeConnector });
      } else {
        await disconnectAllConnections();
      }
      setWalletNotice('Wallet disconnected.');
    } catch (error) {
      setWalletError(errorMessage(error, 'Failed to disconnect wallet.'));
    }
  }

  async function onResetWalletSession() {
    setWalletError(null);
    setWalletNotice(null);
    try {
      await disconnectAllConnections();
      setWalletNotice('Wallet session reset. Connect again to continue.');
    } catch (error) {
      setWalletError(errorMessage(error, 'Failed to reset wallet session.'));
    }
  }

  function onSaveRegistry() {
    try {
      const saved = registry.setRegistryAddress(registryAddressInput.trim());
      setRegistryAddressDraftByChain((prev) => ({ ...prev, [appChainId]: saved }));
      setRegistryAddressError(null);
    } catch (err) {
      setRegistryAddressError(err instanceof Error ? err.message : 'invalid address');
    }
  }

  function onResetRegistry() {
    registry.resetRegistryAddress();
    setRegistryAddressDraftByChain((prev) => {
      if (!(appChainId in prev)) return prev;
      const next = { ...prev };
      delete next[appChainId];
      return next;
    });
    setRegistryAddressError(null);
  }

  async function onDeployRegistry() {
    setRegistryAddressError(null);
    setDeployError(null);
    setDeployNotice(null);
    setDeployTxHash(null);

    if (!isConnected || !address) {
      setDeployError('Connect a wallet to deploy.');
      return;
    }
    if (!publicClient) {
      setDeployError('No public client available for this chain.');
      return;
    }

    if (walletChainId && walletChainId !== appChainId) {
      try {
        setDeployNotice(`Switching wallet to ${currentChain?.name ?? `chain ${appChainId}`}…`);
        await switchChainAsync({ chainId: appChainId });
        setDeployNotice(null);
      } catch (err) {
        setDeployNotice(null);
        setDeployError(err instanceof Error ? err.message : 'Failed to switch wallet network.');
        return;
      }
    }

    if (appChainId === 1) {
      const ok = window.confirm('Deploying on Ethereum mainnet costs gas. Continue?');
      if (!ok) return;
    }

    try {
      setDeployNotice('Sending deploy transaction…');
      const hash = (await deployContract({
        abi: DEAD_DROP_REGISTRY_ABI,
        bytecode: DEAD_DROP_REGISTRY_BYTECODE,
        chainId: appChainId,
      })) as Hex;
      setDeployTxHash(hash);
      setDeployNotice('Waiting for confirmation…');

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const contractAddress = receipt.contractAddress;
      if (!contractAddress) throw new Error('Deploy confirmed, but no contract address found in receipt.');

      const checksummed = getAddress(contractAddress) as Address;
      registry.setRegistryAddress(checksummed);
      setRegistryAddressDraftByChain((prev) => ({ ...prev, [appChainId]: checksummed }));

      setDeployNotice(`Deployed registry: ${truncateMiddle(checksummed)}`);
    } catch (err) {
      setDeployNotice(null);
      setDeployError(err instanceof Error ? err.message : 'Failed to deploy registry.');
    }
  }

  return (
    <>
      <div className="walletTopRight">
        <div className="walletIdentity">
          {isConnected && address ? (
            <span className="walletPill">
              <span className="muted">{walletConnectorName ?? 'Wallet'}</span>
              <code>{truncateMiddle(address)}</code>
            </span>
          ) : (
            <span className="muted">Wallet not connected</span>
          )}
        </div>
        <div className="inline">
          {isConnected && address ? (
            <button className="btn btnGhost" type="button" onClick={onDisconnectCurrent} disabled={isWalletActionPending}>
              {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button className="btn" type="button" onClick={onConnect} disabled={isWalletActionPending}>
              {isConnecting ? 'Connecting…' : isReconnecting ? 'Reconnecting…' : 'Connect wallet'}
            </button>
          )}
          {(hasStaleConnection || walletStatus === 'reconnecting') && (
            <button className="btn btnGhost" type="button" onClick={onResetWalletSession} disabled={isWalletActionPending}>
              Reset session
            </button>
          )}
          <button className="btn btnSecondary" type="button" onClick={() => setIsConfigOpen(true)}>
            Config
          </button>
        </div>
      </div>

      {hasStaleConnection ? (
        <div className="warn">
          Wallet connector is active but no account is selected in the app. Use <strong>Reset session</strong> then connect again.
        </div>
      ) : null}
      {connectError ? <div className="error">{connectError.message}</div> : null}
      {walletNotice ? <div className="notice">{walletNotice}</div> : null}
      {walletError ? <div className="error">{walletError}</div> : null}

      {isConfigOpen ? (
        <div className="modalOverlay" role="presentation" onClick={() => setIsConfigOpen(false)}>
          <section
            className="card modalCard"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-config-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row between center">
              <h2 id="wallet-config-title">Configuration</h2>
              <button className="btn btnGhost" type="button" onClick={() => setIsConfigOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted">Choose app chain and manage the registry for this chain.</p>

            <label className="label">
              Chain
              <select
                className="select"
                value={appChainId}
                disabled={isSwitching}
                onChange={(e) => {
                  setRegistryAddressError(null);
                  switchChain({ chainId: Number(e.target.value) });
                }}
              >
                {chains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>
            </label>

            <div className="walletSessionStatus">
              <span className="muted">Status</span> <code>{walletStatus}</code>
              <span className="muted">Connector</span> <code>{walletConnectorName ?? 'none'}</code>
              <span className="muted">Sessions</span> <code>{connections.length}</code>
              <span className="muted">Address</span> <code>{address ?? 'not connected'}</code>
              <span className="muted">App chain</span> <code>{formatWalletChain(appChainId)}</code>
              <span className="muted">Wallet chain</span> <code>{walletChainId ? formatWalletChain(walletChainId) : 'n/a'}</code>
            </div>

            {isWalletChainMismatch && walletChainId ? (
              <div className="warn">
                <div>
                  Wallet network: <code>{formatWalletChain(walletChainId)}</code>. Switch to{' '}
                  <code>
                    {currentChain?.name ?? 'Selected chain'} ({appChainId})
                  </code>{' '}
                  before sending transactions.
                </div>
                <div style={{ marginTop: 10 }}>
                  <button className="btn btnSecondary" type="button" onClick={() => switchChain({ chainId: appChainId })} disabled={isSwitching}>
                    {isSwitching ? 'Switching…' : 'Switch wallet'}
                  </button>
                </div>
              </div>
            ) : null}

            <label className="label">
              Registry (this chain)
              <input
                className="input"
                value={registryAddressInput}
                onChange={(e) => {
                  setRegistryAddressDraftByChain((prev) => ({ ...prev, [appChainId]: e.target.value }));
                  setRegistryAddressError(null);
                }}
                placeholder={currentChain?.id === 31337 ? 'Deploy locally, then paste address' : '0x…'}
                spellCheck={false}
                inputMode="text"
              />
              <div className="helper">
                {registryAddress ? (
                  <span>
                    Active: <code>{truncateMiddle(registryAddress)}</code>
                  </span>
                ) : (
                  <span className="warn">No registry set. Reads/writes will fail until you set it.</span>
                )}
              </div>
            </label>

            <div className="inline">
              <button
                className="btn btnSecondary"
                type="button"
                onClick={onDeployRegistry}
                disabled={!isConnected || isDeploying || isSwitching || isWalletChainMismatch}
              >
                {isDeploying ? 'Deploying…' : 'Deploy new'}
              </button>
              <button
                className="btn btnSecondary"
                type="button"
                onClick={onSaveRegistry}
                disabled={!isAddress(registryAddressInput.trim())}
              >
                Save
              </button>
              <button className="btn btnGhost" type="button" onClick={onResetRegistry}>
                Reset
              </button>
            </div>

            {registryAddressError ? <div className="error">{registryAddressError}</div> : null}
            {deployNotice ? (
              <div className="notice">
                <div>{deployNotice}</div>
                {deployTxHash ? (
                  <div className="helper">
                    Tx: <code>{truncateMiddle(deployTxHash)}</code>{' '}
                    {blockExplorerTxUrl(appChainId, deployTxHash) ? (
                      <a href={blockExplorerTxUrl(appChainId, deployTxHash)} target="_blank" rel="noreferrer">
                        View →
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {deployError ? <div className="error">{deployError}</div> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
