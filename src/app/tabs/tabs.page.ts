// src/app/tabs/tabs.page.ts
import { Component, ViewChild } from '@angular/core';
import { IonTabs } from '@ionic/angular';
import { IonTabBar, IonTabButton, IonIcon, IonLabel, IonTabs as IonTabsStandalone } from '@ionic/angular/standalone';
import { UiEventService } from '../services/ui-event';


@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: true,
  imports: [IonTabsStandalone, IonTabBar, IonTabButton, IonIcon, IonLabel],
})
export class TabsPage {
  @ViewChild(IonTabsStandalone) tabs?: IonTabs; // ViewChild may be undefined during first click

  constructor(private uiEventService: UiEventService) {} // ❗️ Inject Service

  onTab1Click() {
    if (!this.tabs) {
      return;
    }

    const selectedTab = this.tabs.getSelected();

    if (selectedTab === 'explore') {
      // ❗️ ถ้าอยู่ Tab1 อยู่แล้ว -> ให้สลับ Sheet
      this.uiEventService.toggleExploreSheet();
    } else {
      // ❗️ ถ้าอยู่ Tab อื่น -> ให้ย้ายไป Tab1
      this.tabs.select('explore');
    }
  }
}