import React from 'react'

// Evita que un throw en cualquier componente deje la app en blanco (BUG-003).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error, info) {
    // TODO(OPS-001): enviar a Sentry cuando se integre.
    console.error('UI error:', error, info?.componentStack)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px', textAlign: 'center', fontFamily: "'DM Sans',system-ui,sans-serif", background: '#F8F5FF', color: '#1C1C1E' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🛠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>Algo ha fallado</h1>
          <p style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.6, marginBottom: 24 }}>
            Ha ocurrido un error inesperado. Vuelve a cargar la página; si persiste, inténtalo más tarde.
          </p>
          <button onClick={() => window.location.reload()} style={{ fontFamily: 'inherit', fontSize: 15, fontWeight: 700, padding: '12px 24px', color: '#fff', background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', border: 'none', borderRadius: 14, cursor: 'pointer' }}>
            Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
