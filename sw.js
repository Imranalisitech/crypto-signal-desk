'use strict';
// Installability only: never cache prices, scanner results, or trade state.
// A network connection is required for the browser-only scanner.
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});
