import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'explore',
        loadComponent: () =>
          import('../explore/explore.page').then((m) => m.ExplorePage),
      },
      {
        path: 'bookings',
        loadComponent: () =>
          import('../bookings/bookings.page').then((m) => m.BookingsPage),
      },
      {
        path: 'saved',
        loadComponent: () =>
          import('../saved/saved.page').then((m) => m.SavedPage),
      },
      {
        path: 'recent',
        loadComponent: () =>
          import('../recent/recent.page').then((m) => m.RecentPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('../profile/profile.page').then((m) => m.ProfilePage),
      },
      {
        path: '',
        redirectTo: '/tabs/explore', // ตั้งให้หน้า Explore เป็นหน้าแรก
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/tabs/explore',
    pathMatch: 'full',
  },
];