import React from 'react';
import { motion } from 'framer-motion';

export interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export function GlassCard({ children, className = '', delay = 0 }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      whileHover={{ y: -4, scale: 1.01 }}
      className={`bg-dark-surface/80 backdrop-blur-xl border border-dark-border rounded-2xl shadow-elev-2 p-6 ${className}`}
    >
      {children}
    </motion.div>
  );
}
