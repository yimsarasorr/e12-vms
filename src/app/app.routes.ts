import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'building-access',
    loadComponent: () => import('./building/building.page').then(m => m.BuildingPage)
  },
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.routes').then(m => m.routes)
  }
];