import type { Address } from 'viem';

function truncateMiddle(value: string, start = 6, end = 4): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function AddressChip(props: { address: Address; label?: string }) {
  async function copy() {
    await navigator.clipboard.writeText(props.address);
  }

  return (
    <span className="chip">
      {props.label ? <span className="muted">{props.label} </span> : null}
      <code>{truncateMiddle(props.address)}</code>
      <button className="chipBtn" type="button" onClick={copy} title="Copy address">
        Copy
      </button>
    </span>
  );
}

