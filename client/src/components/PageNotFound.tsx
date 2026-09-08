import { Link } from 'react-router-dom'

export const PageNotFound = () => (
  <main className="placeholder">
    <h1>Page not found</h1>
    <p>
      <Link to="/home">Go back home</Link>
    </p>
  </main>
)
