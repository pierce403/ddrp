import { useEffect, useMemo, useState } from 'react';
import type { Address, Hex } from 'viem';
import { getAddress, isAddress } from 'viem';
import { Link } from 'react-router-dom';
import { usePublicClient, useReadContract } from 'wagmi';

import { AddressChip } from '../components/AddressChip';
import { useRegistryConfig } from '../ddrp/registryConfig';
import { getDecryptedPlaintext } from '../ddrp/decryptedStore';
import { DEAD_DROP_REGISTRY_ABI } from '../ddrp/registry';

type DropRow = Readonly<{
  dropId: bigint;
  sender: Address;
  recipient: Address;
  blockNumber: bigint;
  timestamp: bigint;
  capsule: Hex;
}>;

const PAGE_SIZE = 20;

function formatTimestampSeconds(seconds: bigint): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return seconds.toString();
  return new Date(ms).toLocaleString();
}

type DecryptFilter = 'all' | 'decrypted' | 'notDecrypted';

export function AllDropsPage() {
  const registry = useRegistryConfig();
  const publicClient = usePublicClient();

  const { data: dropCount } = useReadContract({
    address: registry.registryAddress,
    abi: DEAD_DROP_REGISTRY_ABI,
    functionName: 'getDropCount',
    query: { enabled: Boolean(registry.registryAddress) },
  });

  const [rows, setRows] = useState<DropRow[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [recipientFilter, setRecipientFilter] = useState('');
  const [senderFilter, setSenderFilter] = useState('');
  const [decryptFilter, setDecryptFilter] = useState<DecryptFilter>('all');

  useEffect(() => {
    setRows([]);
    setPagesLoaded(0);
    setLoadError(null);
  }, [registry.chainId, registry.registryAddress]);

  useEffect(() => {
    if (!registry.registryAddress) return;
    if (!publicClient) return;
    if (isLoading) return;
    if (pagesLoaded !== 0) return;
    if (rows.length !== 0) return;
    if (((dropCount ?? 0n) as bigint) === 0n) return;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry.registryAddress, publicClient, dropCount, pagesLoaded, rows.length, isLoading]);

  async function loadMore() {
    if (!registry.registryAddress) {
      setLoadError('Set the registry address first.');
      return;
    }
    if (!publicClient) {
      setLoadError('No public client available for this chain.');
      return;
    }

    const total = (dropCount ?? 0n) as bigint;
    const page = pagesLoaded;
    const endExclusive = total - BigInt(page) * BigInt(PAGE_SIZE);
    if (endExclusive <= 0n) return;

    const start = endExclusive > BigInt(PAGE_SIZE) ? endExclusive - BigInt(PAGE_SIZE) : 0n;
    const count = endExclusive - start;
    if (count <= 0n) return;

    try {
      setIsLoading(true);
      setLoadError(null);

      const pageDrops = (await publicClient.readContract({
        address: registry.registryAddress,
        abi: DEAD_DROP_REGISTRY_ABI,
        functionName: 'getDropsRange',
        args: [start, count],
      })) as Array<Omit<DropRow, 'dropId'>>;

      const pageRows = pageDrops
        .map((d, i) => ({ dropId: start + BigInt(i), ...d }))
        .reverse(); // newest first

      setRows((prev) => [...prev, ...pageRows]);
      setPagesLoaded((prev) => prev + 1);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'failed to load drops');
    } finally {
      setIsLoading(false);
    }
  }

  const filters = useMemo(() => {
    const out: { sender?: Address; recipient?: Address; error?: string } = {};
    if (senderFilter.trim()) {
      if (!isAddress(senderFilter.trim())) return { error: 'Sender filter is not a valid address.' };
      out.sender = getAddress(senderFilter.trim());
    }
    if (recipientFilter.trim()) {
      if (!isAddress(recipientFilter.trim())) return { error: 'Recipient filter is not a valid address.' };
      out.recipient = getAddress(recipientFilter.trim());
    }
    return out;
  }, [senderFilter, recipientFilter]);

  const visibleRows = useMemo(() => {
    let out = rows;
    if (filters.sender) out = out.filter((r) => getAddress(r.sender) === filters.sender);
    if (filters.recipient) out = out.filter((r) => getAddress(r.recipient) === filters.recipient);

    if (decryptFilter !== 'all' && registry.registryAddress) {
      out = out.filter((r) => {
        const plaintext = getDecryptedPlaintext({
          chainId: registry.chainId,
          registryAddress: registry.registryAddress!,
          dropId: r.dropId,
        });
        return decryptFilter === 'decrypted' ? Boolean(plaintext) : !plaintext;
      });
    }

    return out;
  }, [rows, filters.sender, filters.recipient, decryptFilter, registry.chainId, registry.registryAddress]);

  const hasMore = useMemo(() => {
    const total = (dropCount ?? 0n) as bigint;
    return BigInt(pagesLoaded) * BigInt(PAGE_SIZE) < total;
  }, [dropCount, pagesLoaded]);

  return (
    <div className="stack">
      <section className="card">
        <div className="row between center">
          <h2>All Drops</h2>
          <Link className="linkBtn" to="/">
            ← Home
          </Link>
        </div>

        <div className="grid2">
          <label className="label">
            Recipient filter
            <input
              className="input"
              value={recipientFilter}
              onChange={(e) => setRecipientFilter(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
            />
          </label>
          <label className="label">
            Sender filter
            <input
              className="input"
              value={senderFilter}
              onChange={(e) => setSenderFilter(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="row between center">
          <label className="label inline">
            Show
            <select className="select" value={decryptFilter} onChange={(e) => setDecryptFilter(e.target.value as DecryptFilter)}>
              <option value="all">All</option>
              <option value="decrypted">Decrypted locally</option>
              <option value="notDecrypted">Not decrypted locally</option>
            </select>
          </label>

          <div className="inline">
            <button className="btn btnSecondary" type="button" onClick={loadMore} disabled={isLoading || !hasMore}>
              {isLoading ? 'Loading…' : hasMore ? 'Load older' : 'No more'}
            </button>
          </div>
        </div>

        <div className="helper muted">
          Filters are client-side (v1). If you don’t see a match yet, click “Load older”.
        </div>

        {!registry.registryAddress ? <div className="warn">Set the registry address to load drops.</div> : null}
        {filters.error ? <div className="error">{filters.error}</div> : null}
        {loadError ? <div className="error">{loadError}</div> : null}

        {visibleRows.length === 0 ? (
          <div className="muted">No drops loaded yet.</div>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Sender</th>
                  <th>Recipient</th>
                  <th>Drop</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const decrypted =
                    registry.registryAddress &&
                    Boolean(
                      getDecryptedPlaintext({
                        chainId: registry.chainId,
                        registryAddress: registry.registryAddress,
                        dropId: row.dropId,
                      }),
                    );

                  return (
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
                      <td>{decrypted ? <span className="badge ok">Decrypted</span> : <span className="badge">Encrypted</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
