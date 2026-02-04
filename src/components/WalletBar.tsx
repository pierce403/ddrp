import { useMemo, useState } from 'react';
import { isAddress } from 'viem';
import { useAccount, useChainId, useChains, useConnect, useDisconnect, useSwitchChain } from 'wagmi';

import { useRegistryConfig } from '../ddrp/registryConfig';

function truncateMiddle(value: string, start = 6, end = 4): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function WalletBar() {
  const chainId = useChainId();
  const chains = useChains();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const registry = useRegistryConfig();

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();

  const [registryAddressDraftByChain, setRegistryAddressDraftByChain] = useState<Record<number, string>>({});
  const [registryAddressError, setRegistryAddressError] = useState<string | null>(null);

  const registryAddress = registry.registryAddress;
  const registryAddressInput = registryAddressDraftByChain[chainId] ?? registryAddress ?? '';

  const currentChain = useMemo(() => chains.find((c) => c.id === chainId), [chains, chainId]);

  function onConnect() {
    const connector = connectors[0];
    if (!connector) return;
    connect({ connector });
  }

  function onSaveRegistry() {
    try {
      const saved = registry.setRegistryAddress(registryAddressInput.trim());
      setRegistryAddressDraftByChain((prev) => ({ ...prev, [chainId]: saved }));
      setRegistryAddressError(null);
    } catch (err) {
      setRegistryAddressError(err instanceof Error ? err.message : 'invalid address');
    }
  }

  function onResetRegistry() {
    registry.resetRegistryAddress();
    setRegistryAddressDraftByChain((prev) => {
      if (!(chainId in prev)) return prev;
      const next = { ...prev };
      delete next[chainId];
      return next;
    });
    setRegistryAddressError(null);
  }

  return (
    <div className="walletBar">
      <div className="walletRow">
        <label className="label">
          Chain
          <select
            className="select"
            value={chainId}
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

        <div className="walletRight">
          {isConnected && address ? (
            <div className="inline">
              <span className="muted">Wallet</span> <code>{truncateMiddle(address)}</code>
              <button className="btn btnGhost" type="button" onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn" type="button" onClick={onConnect} disabled={isConnecting}>
              {isConnecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
      </div>

      <div className="walletRow">
        <label className="label grow">
          Registry (this chain)
          <input
            className="input"
            value={registryAddressInput}
            onChange={(e) => {
              setRegistryAddressDraftByChain((prev) => ({ ...prev, [chainId]: e.target.value }));
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
            onClick={onSaveRegistry}
            disabled={!isAddress(registryAddressInput.trim())}
          >
            Save
          </button>
          <button className="btn btnGhost" type="button" onClick={onResetRegistry}>
            Reset
          </button>
        </div>
      </div>

      {registryAddressError ? <div className="error">{registryAddressError}</div> : null}
      {connectError ? <div className="error">{connectError.message}</div> : null}
    </div>
  );
}
