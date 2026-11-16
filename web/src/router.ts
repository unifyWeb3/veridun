export type Route =
  | { name: 'overview' }
  | { name: 'tasks' }
  | { name: 'task-detail'; taskId: string }
  | { name: 'proofs' }
  | { name: 'not-found' };

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/overview') return { name: 'overview' };
  if (path === '/tasks') return { name: 'tasks' };
  if (path === '/proofs') return { name: 'proofs' };

  const taskMatch = /^\/tasks\/([^/]+)$/.exec(path);
  if (taskMatch) {
    try {
      return { name: 'task-detail', taskId: decodeURIComponent(taskMatch[1]) };
    } catch {
      return { name: 'not-found' };
    }
  }

  return { name: 'not-found' };
}

export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('veridun:navigate'));
  window.scrollTo({ top: 0, behavior: 'instant' });
}
