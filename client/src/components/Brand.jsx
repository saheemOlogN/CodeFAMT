export default function Brand({ large = false }) {
  return (
    <span className={`brand ${large ? 'brand-large' : ''}`}>
      <span className="brand-logo" aria-hidden="true">
        <img src="/codefamt-logo.png?v=2" alt="" width="1536" height="1024" />
      </span>
      <span>
        Code<span className="brand-accent">FAMT</span>
      </span>
    </span>
  )
}
