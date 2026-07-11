import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('alex@socialflow.ai');
  const [password, setPassword] = useState('demo1234');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast('Enter your email to continue.', 'error');
      return;
    }
    login(email.trim());
    toast('Welcome back to SocialFlow AI.', 'success');
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-[#030303] overflow-hidden">
      <div className="bg-glow" />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="glass-card relative z-10 w-full max-w-md p-10"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-glow-rose bg-gradient-to-br from-primary-rose to-primary-blue">
            <MaterialIcon name="rocket_launch" className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
            SocialFlow AI
          </h1>
        </div>

        <h2 className="text-xl font-bold text-white mb-1">Sign in to your workspace</h2>
        <p className="text-sm text-gray-subtext mb-8">Manage every channel from one AI-powered cockpit.</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
              placeholder="you@company.com"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            className="btn-primary w-full py-3"
          >
            <MaterialIcon name="login" className="text-lg" />
            Sign In
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-gray-subtext">
          Demo workspace · any email + password works
        </p>
      </motion.div>
    </div>
  );
};
