// main.jsx
import { supabase } from './supabase'

window.__preload = Promise.all([
  supabase.from('services').select('*').eq('active', true).order('display_order'),
  supabase.from('stylists').select('*').eq('active', true).order('display_order'),
])

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
