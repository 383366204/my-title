import { useState, useCallback } from 'react';

/**
 * Determine whether sidebars should start collapsed based on viewport width.
 * Only evaluated once at mount time; does not re-evaluate on resize.
 */
function shouldCollapseSidebarInitially() {
  return (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 980px)').matches
  );
}

/**
 * Manages sidebar collapse state for the workflow studio layout.
 *
 * Owns left/right sidebar collapsed state and toggle handlers.
 * When one sidebar opens on narrow viewports, the other auto-collapses
 * to avoid overlapping content.
 *
 * @returns {{
 *   leftSidebarCollapsed: boolean,
 *   rightSidebarCollapsed: boolean,
 *   toggleLeftSidebar: () => void,
 *   toggleRightSidebar: () => void
 * }}
 */
export function useWorkflowLayout() {
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(shouldCollapseSidebarInitially);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(true);

  const toggleLeftSidebar = useCallback(() => {
    if (shouldCollapseSidebarInitially()) setRightSidebarCollapsed(true);
    setLeftSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const toggleRightSidebar = useCallback(() => {
    if (shouldCollapseSidebarInitially()) setLeftSidebarCollapsed(true);
    setRightSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  return {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar
  };
}
