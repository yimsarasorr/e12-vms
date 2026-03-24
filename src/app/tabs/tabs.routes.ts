import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'explore',
        loadComponent: () => import('../explore/explore.page').then(m => m.ExplorePage)
      },
      {
        path: 'profile',
        loadComponent: () => import('../profile/profile.page').then(m => m.ProfilePage)
      },
      {
        path: 'tickets',
        loadComponent: () => import('../tickets/tickets.page').then(m => m.TicketsPage)
      },
      {
        path: 'saved',
        loadComponent: () => import('../saved/saved.page').then(m => m.SavedPage)
      },
      {
        path: 'building',
        redirectTo: '/building-access',
        pathMatch: 'full'
      },
      {
        path: 'tab1',
        redirectTo: '/tabs/explore',
        pathMatch: 'full'
      },
      {
        path: 'tab2',
        redirectTo: '/tabs/tickets',
        pathMatch: 'full'
      },
      {
        path: 'tab3',
        redirectTo: '/tabs/profile',
        pathMatch: 'full'
      },
      {
        path: 'tab4',
        redirectTo: '/tabs/tickets',
        pathMatch: 'full'
      },
      {
        path: 'tab6',
        redirectTo: '/tabs/saved',
        pathMatch: 'full'
      },
      {
        path: '',
        redirectTo: '/tabs/explore',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '',
    redirectTo: '/tabs/explore',
    pathMatch: 'full'
  }
];