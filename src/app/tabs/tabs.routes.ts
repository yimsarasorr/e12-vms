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
        path: 'reservations',
        loadComponent: () => import('../reservations/reservations.page').then(m => m.ReservationsPage)
      },
      {
        path: 'profile',
        loadComponent: () => import('../profile/profile.page').then(m => m.ProfilePage)
      },
      {
        path: 'building',
        loadComponent: () => import('../building/building.page').then(m => m.BuildingPage)
      },
      {
        path: 'saved',
        loadComponent: () => import('../saved/saved.page').then(m => m.SavedPage)
      },
      {
        path: 'tab1',
        redirectTo: '/tabs/explore',
        pathMatch: 'full'
      },
      {
        path: 'tab2',
        redirectTo: '/tabs/reservations',
        pathMatch: 'full'
      },
      {
        path: 'tab3',
        redirectTo: '/tabs/profile',
        pathMatch: 'full'
      },
      {
        path: 'tab4',
        redirectTo: '/tabs/building',
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