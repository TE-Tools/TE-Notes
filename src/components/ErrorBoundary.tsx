import { Component, type ErrorInfo, type ReactNode } from 'react';
import { flushAll } from '../lib/saver';

interface Props {
  children: ReactNode;
  /** Bei Änderung (z. B. andere Seite) wird der Fehlerzustand zurückgesetzt */
  resetKey?: string;
}
interface State {
  error: Error | null;
}

/** Fängt Fehler beim Anzeigen einer Seite ab – statt eines weißen Bildschirms erscheint ein Hinweis */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('TE Notes – Fehler beim Anzeigen:', error, info.componentStack);
    try {
      flushAll();
    } catch {
      /* ignorieren */
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 560, margin: '10vh auto', padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Diese Seite konnte nicht angezeigt werden</h2>
          <p>Deine Daten sind nicht verloren. Bitte die Seite neu laden. Hilft das nicht, gib diese Fehlermeldung an den Support weiter:</p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, background: 'var(--bg-2, rgba(0,0,0,.05))', padding: 12, borderRadius: 8 }}>
            {(error.name ? error.name + ': ' : '') + error.message}
          </pre>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => location.reload()}>Neu laden</button>
            <button
              className="btn"
              onClick={() => {
                location.hash = '#/';
                this.setState({ error: null });
              }}
            >
              Zum Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
