import './IntuitionPage.css'

export default function IntuitionPage() {
  return <article className="platform-page intuition-page">
    <header className="intuition-intro">
      <p className="intuition-eyebrow">The story behind CodeFAMT</p>
      <h1>Intuition</h1>
      <p className="intuition-question">Why doesn’t our college have its own competitive programming platform?</p>
      <p>That question became CodeFAMT: a shared place for students at Finolex Academy of Management and Technology to practise, compete, and learn together.</p>
    </header>
    <section className="intuition-purpose" aria-labelledby="purpose-title">
      <h2 id="purpose-title">Built for our college</h2>
      <p>College contests give us a reason to challenge ourselves. Practice problems help us keep going after a contest ends. A guided roadmap brings structure to learning C++ and data structures and algorithms.</p>
      <p>The aim is simple: make consistent practice and friendly competition part of our college culture.</p>
    </section>
    <section aria-labelledby="people-title">
      <h2 id="people-title">The people behind it</h2>
      <div className="intuition-people">
        <section><p className="intuition-role">Developer</p><h3>Saheem</h3><p>Building CodeFAMT and bringing the idea to life.</p><a href="https://saheem-nakhwa.vercel.app" target="_blank" rel="noopener noreferrer">Visit Saheem’s portfolio ↗</a></section>
        <section><p className="intuition-role">Technical Admin</p><h3>Ved</h3><p>Technical administration for CodeFAMT.</p><a href="https://www.linkedin.com/in/ved-khanvilkar-v101/" target="_blank" rel="noopener noreferrer">Connect with Ved on LinkedIn ↗</a></section>
      </div>
    </section>
  </article>
}
