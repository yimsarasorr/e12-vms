import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

// กำหนดประเภทเนื้อหาที่จะโชว์
export type SheetMode = 'building-list' | 'access-list' | 'building-detail' | 'hidden' | 'location-detail' | 'room-detail';
// [แก้ไข] เพิ่ม 'partial'
export type ExpansionState = 'peek' | 'partial' | 'default' | 'expanded';

// โครงสร้างข้อมูลที่จะส่งมา
export interface SheetData {
  mode: SheetMode;
  data?: any; // list ตึก, list ห้อง, หรือ detail ตึก
  title?: string;
}

@Injectable({
  providedIn: 'root'
})
export class BottomSheetService {
  // State หลัก: ตอนนี้โชว์อะไรอยู่
  private sheetStateSubject = new BehaviorSubject<SheetData>({ mode: 'hidden' });
  public sheetState$ = this.sheetStateSubject.asObservable();

  // State ความสูง: ให้ Component อื่นสั่งยืด/หดได้ถ้าต้องการ
  private expansionStateSubject = new BehaviorSubject<ExpansionState>('default');
  public expansionState$ = this.expansionStateSubject.asObservable();

  // เพิ่ม Subject สำหรับส่ง Action กลับไปยัง AppComponent (เช่น กดปุ่ม "เข้าสู่อาคาร")
  private actionSubject = new Subject<{ action: string, payload?: any }>();
  public action$ = this.actionSubject.asObservable();

  // --- Actions ---

  /** สั่งเปิด Sheet ในโหมดต่างๆ */
  open(mode: SheetMode, data?: any, title?: string, initialState: ExpansionState = 'default') {
    this.sheetStateSubject.next({ mode, data, title });
    this.expansionStateSubject.next(initialState);
  }

  /** สั่งปิด Sheet */
  close() {
    this.sheetStateSubject.next({ mode: 'hidden' });
  }

  /** สั่งเปลี่ยนความสูง (Peek / Default / Expanded) */
  setExpansionState(state: ExpansionState) {
    if (this.expansionStateSubject.getValue() === state) {
      return;
    }
    this.expansionStateSubject.next(state);
  }

  /** คืนค่าความสูงปัจจุบันของแผ่นป็อปอัพ */
  getCurrentExpansionState(): ExpansionState {
    return this.expansionStateSubject.getValue();
  }

  /** Helper: เปิดหน้ารายชื่อตึก (สำหรับ Map) */
  showBuildingList(buildings: any[]) {
    this.open('building-list', buildings, 'สถานที่ใกล้เคียง');
  }

  /** Helper: เปิดหน้ารายชื่อห้อง (สำหรับ Floor Plan) */
  showAccessList(rooms: any[], initialState: ExpansionState = 'peek') {
    this.open('access-list', rooms, 'พื้นที่ที่เข้าถึงได้', initialState);
  }

  /** Helper: เปิดหน้ารายละเอียดสถานที่ (สำหรับ Map) */
  showLocationDetail(locationData: any) {
    this.open('location-detail', locationData, undefined, 'peek');
  }

  /** Helper: เปิดหน้ารายละเอียดห้อง (สำหรับ Floor Plan) */
  showRoomDetail(roomData: any) {
    // [แก้ไข] ใช้ 'partial' แทน 'default'
    this.open('room-detail', roomData, roomData.name || 'รายละเอียดห้อง', 'partial');
  }

  /** Helper: กลับไปหน้า Access List */
  goBackToAccessList(previousData: any) {
    this.open('access-list', previousData, 'พื้นที่ที่เข้าถึงได้', 'default');
  }

  /** ฟังก์ชันส่ง Action (เช่น กดปุ่ม Enter Building) */
  triggerAction(action: string, payload?: any) {
    this.actionSubject.next({ action, payload });
  }
}