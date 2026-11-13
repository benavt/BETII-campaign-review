import {loadApplication} from './startup.mjs';
await loadApplication({root:document.getElementById('app'),importApplication:()=>import('./app.js'),reload:()=>location.reload()});
