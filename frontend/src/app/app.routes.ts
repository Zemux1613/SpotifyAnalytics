import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { PlaylistsComponent } from './playlists/playlists.component';

export const routes: Routes = [
  {
    path: 'dashboard',
    title: 'Dashboard | SpotifyAnalytics',
    canActivate: [authGuard],
    loadComponent: () => import('./dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'login',
    title: 'Anmelden | SpotifyAnalytics',
    canActivate: [guestGuard],
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'top',
    title: 'Top-Listen | SpotifyAnalytics',
    canActivate: [authGuard],
    loadComponent: () => import('./top/top.component').then((m) => m.TopComponent),
  },
  {
    path: 'search',
    title: 'Song suchen | SpotifyAnalytics',
    canActivate: [authGuard],
    loadComponent: () => import('./search/search.component').then((m) => m.SearchComponent),
  },
  { path: 'playlists', component: PlaylistsComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
