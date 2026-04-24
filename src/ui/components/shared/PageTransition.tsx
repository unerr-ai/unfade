import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Enter-only fade. No exit animation — exit animations with AnimatePresence
 * mode="wait" block React Router navigation, creating a waterfall:
 * exit anim → Suspense → data fetch → enter anim. Removing the exit
 * lets the new page mount immediately.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
