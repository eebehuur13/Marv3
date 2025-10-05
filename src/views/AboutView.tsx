export function AboutView() {
  return (
    <section className="about-panel panel-surface">
      <header className="about-panel__header">
        <h2>Meet Marble</h2>
        <p>Find, connect, and create from every file.</p>
      </header>
      <div className="about-panel__grid">
        <article>
          <h3>What it is</h3>
          <p>
            Marble is an enterprise multimodal search and generation platform that turns scattered docs, sheets,
            decks, recordings, videos, and designs into a connected, living knowledge fabric.
          </p>
        </article>
        <article>
          <h3>What it does</h3>
          <p>
            It indexes text, audio, video, and images into a shared semantic space so you can search by meaning across
            formats and turn results into grounded outputs—summaries, reports, playbooks, and highlight reels.
          </p>
        </article>
        <article>
          <h3>Why it fits the enterprise</h3>
          <p>
            Permissions and roles enforced by default, full audit logs, compliance tagging, version history, and smooth
            collaboration via shareable searches, annotations, collections, and integrations with the tools you already
            use.
          </p>
        </article>
      </div>
      <footer className="about-panel__footer">
        <p className="about-panel__signature">Designed &amp; Built by Harish Adithya.</p>
      </footer>
    </section>
  );
}
