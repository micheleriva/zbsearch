import Link from '@docusaurus/Link'
import Layout from '@theme/Layout'

export default function Home() {
  return (
    <Layout title="Home" description="Docusaurus sandbox for the ZBSearch plugin">
      <main style={{ padding: '4rem 1rem', textAlign: 'center' }}>
        <h1>ZBSearch Sandbox</h1>
        <p>Press ⌘K, or Ctrl+K, to search this site.</p>
        <Link className="button button--primary button--lg" to="/docs/intro">
          Read the docs
        </Link>
      </main>
    </Layout>
  )
}
