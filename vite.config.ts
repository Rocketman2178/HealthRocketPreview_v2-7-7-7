import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  
  // === ENHANCED BUILD OPTIMIZATION FOR HEALTH ROCKET ===
  build: {
    // Strategic code splitting for Health Rocket components
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React libraries - loaded first
          vendor: ['react', 'react-dom', 'react-router-dom'],
          
          // Supabase backend services - critical for Health Rocket
          supabase: ['@supabase/supabase-js'],
          
          // Payment processing - subscription management
          stripe: ['@stripe/stripe-js', '@stripe/react-stripe-js'],
          
          // Health device integrations - Vital API
          vital: ['@tryvital/vital-link', '@tryvital/vital-node'],
          
          // UI component library - icons and utilities
          ui: ['lucide-react', 'clsx', 'tailwind-merge'],
          
          // Date handling for Health Rocket time tracking
          dates: ['date-fns', 'date-fns-tz'],
          
          // Heavy UI components - emoji picker for gamification
          pickers: ['emoji-picker-react'],
          
          // Utilities and helpers
          utils: ['uuid']
        }
      }
    },
    
    // Optimize for Health Rocket's component size
    chunkSizeWarningLimit: 1000,
    
    // Enhanced build performance
    target: 'esnext',
    sourcemap: process.env.NODE_ENV === 'development',
    
    // Optimize minification for production
    minify: process.env.NODE_ENV === 'production' ? 'esbuild' : false,
    
    // Improve build performance
    reportCompressedSize: false
  },

  // === DEVELOPMENT SERVER OPTIMIZATION ===
  server: {
    // Fast refresh for Health Rocket development
    hmr: {
      overlay: true
    },
    
    // Network access configuration for Bolt.new
    host: true,
    port: 5173,
    strictPort: false,  // Allow automatic port switching
    
    // Enable CORS for Health Rocket API integrations
    cors: true,
    
    // Optimize for Bolt.new environment
    open: false,  // Don't auto-open browser in Bolt
    clearScreen: false  // Keep terminal output visible
  },

  // === DEPENDENCY PRE-BUNDLING OPTIMIZATION ===
  optimizeDeps: {
    // Pre-bundle critical Health Rocket dependencies
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@supabase/supabase-js',
      'lucide-react',
      'clsx',
      'tailwind-merge',
      'date-fns',
      'uuid'
    ],
    
    // Exclude Node.js specific packages
    exclude: [
      '@tryvital/vital-node'  // Server-side only
    ]
  },

  // === HEALTH ROCKET APP CONSTANTS ===
  define: {
    // Development mode flag
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
    
    // Health Rocket version info
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    
    // Environment variables (safely stringified)
    __SUPABASE_URL__: JSON.stringify(process.env.VITE_SUPABASE_URL || ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || ''),
    __STRIPE_PUBLISHABLE_KEY__: JSON.stringify(process.env.VITE_STRIPE_PUBLISHABLE_KEY || ''),
    __VITAL_API_KEY__: JSON.stringify(process.env.VITE_VITAL_API_KEY || '')
  },

  // === CSS AND STYLING OPTIMIZATION ===
  css: {
    // PostCSS for Tailwind CSS
    postcss: './postcss.config.js',
    
    // Development source maps for debugging
    devSourcemap: true
  },

  // === CLEAN IMPORT ALIASES FOR HEALTH ROCKET ===
  resolve: {
    alias: {
      '@': '/src',
      '@components': '/src/components',
      '@hooks': '/src/hooks',
      '@lib': '/src/lib',
      '@types': '/src/types',
      '@contexts': '/src/contexts',
      '@data': '/src/data',
      '@styles': '/src/styles'
    }
  }
})