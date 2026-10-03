import { useState, type ReactNode } from 'react';

import { useSocket } from '../../contexts/SocketContext';
import { useMountEffect } from '../../hooks/useMountEffect';
import { getHealth, type HealthStatus } from '../../services/api';
import { withBasePath } from '../../utils/basePath';
import { shortBuildId } from '../../utils/buildVersion';
import { isRecord } from '../../utils/objectHelpers';

const REPO_URL = 'https://github.com/mikaeltarquin/shelfmark';

interface SystemPageProps {
  buildVersion?: string;
  releaseVersion?: string;
  searchMode?: string;
  debug?: boolean;
  onShowToast: (
    message: string,
    type: 'success' | 'error' | 'info',
    persistent?: boolean,
  ) => string;
  onRemoveToast: (id: string) => void;
}

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-xl border border-(--border-muted) bg-(--bg-soft)">
    <h2 className="border-b border-(--border-muted) px-5 py-3 text-sm font-semibold">{title}</h2>
    <div className="px-5 py-4">{children}</div>
  </section>
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline gap-4 py-1.5 text-sm">
    <dt className="w-36 shrink-0 opacity-60">{label}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </div>
);

const StatusDot = ({ ok }: { ok: boolean }) => (
  <span
    className={`mr-2 inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
    aria-hidden="true"
  />
);

const linkClass = 'text-sm font-medium text-sky-600 hover:underline dark:text-sky-400';
const toolButtonClass =
  'rounded-lg border border-(--border-muted) bg-(--bg) px-4 py-2 text-sm font-medium transition-colors hover:bg-(--hover-surface)';

/** System: what's running, whether it's healthy, and where to get help (as in Sonarr). */
export const SystemPage = ({
  buildVersion,
  releaseVersion,
  searchMode,
  debug = false,
  onShowToast,
  onRemoveToast,
}: SystemPageProps) => {
  const { connected } = useSocket();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState(false);

  useMountEffect(() => {
    let cancelled = false;
    getHealth()
      .then((result) => {
        if (!cancelled) setHealth(result);
      })
      .catch(() => {
        if (!cancelled) setHealthError(true);
      });
    return () => {
      cancelled = true;
    };
  });

  const versionDisplay = releaseVersion && releaseVersion !== 'N/A' ? releaseVersion : 'dev';
  const buildId = shortBuildId(buildVersion);
  const degraded = Object.entries(health?.degraded ?? {});

  const handleDebugDownload = async () => {
    const loadingToastId = onShowToast(
      'Gathering debug logs... This may take a minute.',
      'info',
      true,
    );
    try {
      const response = await fetch(withBasePath('/api/debug'), {
        method: 'GET',
        credentials: 'include',
      });
      onRemoveToast(loadingToastId);

      if (!response.ok) {
        const errorData: unknown = await response.json().catch(() => null);
        const errorMessage =
          isRecord(errorData) && typeof errorData.error === 'string'
            ? errorData.error
            : response.statusText;
        onShowToast(`Debug download failed: ${errorMessage}`, 'error');
        return;
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'debug.zip';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      onShowToast('Debug logs downloaded successfully', 'success');
    } catch (error) {
      onRemoveToast(loadingToastId);
      console.error('Debug download error:', error);
      onShowToast('Debug download failed. Check console for details.', 'error');
    }
  };

  let serverHealth: ReactNode = 'Checking…';
  if (healthError) {
    serverHealth = (
      <>
        <StatusDot ok={false} />
        Not responding
      </>
    );
  } else if (health) {
    serverHealth = (
      <>
        <StatusDot ok={degraded.length === 0} />
        {degraded.length === 0 ? 'OK' : 'Degraded'}
      </>
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="system-title">
      <div>
        <p className="text-xs font-medium tracking-wide uppercase opacity-60">System</p>
        <h1 id="system-title" className="text-2xl font-semibold">
          Status
        </h1>
      </div>

      <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
        <Card title="About">
          <dl>
            <Row label="Version">
              {versionDisplay}
              {buildId && <span className="opacity-60"> ({buildId})</span>}
            </Row>
            {buildVersion && buildVersion !== 'N/A' && <Row label="Build">{buildVersion}</Row>}
            {searchMode && (
              <Row label="Search mode">{searchMode === 'universal' ? 'Universal' : 'Direct'}</Row>
            )}
            <Row label="Debug mode">{debug ? 'On' : 'Off'}</Row>
          </dl>
        </Card>

        <Card title="Health">
          <dl>
            <Row label="Server">{serverHealth}</Row>
            <Row label="Live updates">
              <StatusDot ok={connected} />
              {connected ? 'Connected' : 'Not connected (polling)'}
            </Row>
          </dl>
          {degraded.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-amber-700 dark:text-amber-300">
              {degraded.map(([feature, message]) => (
                <li key={feature}>{message}</li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Support">
          <ul className="space-y-2">
            <li>
              <a
                href={`${REPO_URL}/issues`}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                Report a bug
              </a>
            </li>
            <li>
              <a
                href={`${REPO_URL}#readme`}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClass}
              >
                Documentation
              </a>
            </li>
            <li>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
                Source code on GitHub
              </a>
            </li>
          </ul>
        </Card>

        <Card title="Logs & Tools">
          {debug ? (
            <div className="space-y-3">
              <p className="text-sm opacity-70">
                Gather the logs and system details into a zip to attach to a bug report.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={toolButtonClass}
                  onClick={() => void handleDebugDownload()}
                >
                  Download debug logs
                </button>
                <form action={withBasePath('/api/restart')} method="get">
                  <button
                    type="submit"
                    className={`${toolButtonClass} text-orange-600 dark:text-orange-400`}
                  >
                    Restart
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <p className="text-sm opacity-70">
              Debug logs and restart are available with Debug Mode on (Settings → General →
              Advanced).
            </p>
          )}
        </Card>
      </div>
    </section>
  );
};
