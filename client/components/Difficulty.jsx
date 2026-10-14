export default function Difficulty({ value }) {
  return <span className={`difficulty ${value?.toLowerCase()}`}>{value}</span>;
}
