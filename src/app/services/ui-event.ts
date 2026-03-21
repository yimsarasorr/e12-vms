import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UiEventService {

  private toggleExploreSheetSubject = new Subject<void>();
  toggleExploreSheet$ = this.toggleExploreSheetSubject.asObservable();

  private refreshParkingDataSubject = new Subject<void>();
  refreshParkingData$ = this.refreshParkingDataSubject.asObservable();

  constructor() { }

  // ฟังก์ชันนี้จะถูกเรียกจาก tabs.page.ts
  toggleExploreSheet() {
    this.toggleExploreSheetSubject.next();
  }

  triggerRefreshParkingData() {
    this.refreshParkingDataSubject.next();
  }
}