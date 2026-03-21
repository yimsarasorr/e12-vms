import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, map, startWith } from 'rxjs';
import {
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonBadge,
  IonNote
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { lockClosedOutline, locationOutline, checkmarkCircle, closeCircle, chevronForwardOutline } from 'ionicons/icons';

import { FloorplanInteractionService } from '../../services/floorplan/floorplan-interaction.service';
import { FloorplanBuilderService } from '../../services/floorplan/floorplan-builder.service';
import { BottomSheetService } from '../../services/bottom-sheet.service';

interface DoorStatus {
  id: string;
  label: string;
  allowed: boolean;
}

interface RoomAccessSummary {
  id: string;
  name: string;
  floor: number;
  zoneName?: string;
  color: string;
  doors: DoorStatus[];
  boundary?: any;
  center?: any;
}

@Component({
  selector: 'app-access-list',
  standalone: true,
  imports: [
    CommonModule,
    IonList,
    IonItem,
    IonLabel,
    IonIcon,
    IonBadge,
    IonNote
  ],
  templateUrl: './access-list.component.html',
  styleUrls: ['./access-list.component.css']
})
export class AccessListComponent implements OnInit {
  // เปลี่ยนชื่อ instance ให้สอดคล้องกับการใช้งานใหม่
  private interaction = inject(FloorplanInteractionService);
  private builder = inject(FloorplanBuilderService);
  private bottomSheet = inject(BottomSheetService);

  public accessibleRooms$!: Observable<{ floor: number; rooms: RoomAccessSummary[] }[]>;

  constructor() {
    addIcons({lockClosedOutline,chevronForwardOutline,locationOutline,checkmarkCircle,closeCircle});
  }

  ngOnInit(): void {
    this.accessibleRooms$ = this.interaction.permissionList$.pipe(
      startWith([]),
      map(assetIds => this.buildRoomsByFloor(assetIds))
    );
  }

  // [ลบ] focusRoom (เดิม) และแทนที่ด้วย selectRoom
  selectRoom(room: RoomAccessSummary) {
    // 1) โฟกัสไปที่ห้องใน 3D โดยไม่เปิด Modal
    this.interaction.focusOnAsset(room.id, false);

    // 2) เปิด Bottom Sheet: Room Detail
    this.bottomSheet.showRoomDetail(room);
  }

  // [เพิ่ม] ฟังก์ชันสำหรับกดเลือกห้อง (เรียกจาก HTML)
  focusRoom(room: RoomAccessSummary) {
    console.log('Selecting room:', room.id); // เช็ค log
    // 1. โฟกัสห้องใน 3D โดยไม่เปิด Modal
    this.interaction.focusOnAsset(room.id, false);
    // 2. เปิด Bottom Sheet: Room Detail
    this.bottomSheet.showRoomDetail(room);
  }

  // [เพิ่ม] แยก "ห้อง" ออกจากชื่อห้อง
  getRoomDisplay(fullName: string) {
    if (fullName && fullName.includes('ห้อง')) {
      return {
        prefix: 'ห้อง',
        number: fullName.replace('ห้อง', '').trim()
      };
    }
    return {
      prefix: '',
      number: fullName
    };
  }

  private buildRoomsByFloor(allowList: string[]): { floor: number; rooms: RoomAccessSummary[] }[] {
    const floorData = this.interaction.getCurrentFloorData();
    if (!floorData?.zones) {
      return [];
    }
    const allowedSet = new Set((allowList || []).filter(Boolean));
    const floorMap = new Map<number, RoomAccessSummary[]>();

    floorData.zones.forEach((zone: any) => {
      zone.rooms?.forEach((room: any) => {
        const doorStatuses: DoorStatus[] = (room.doors || []).map((door: any) => ({
          id: door.id,
          label: door.name ?? 'ประตู',
          allowed: allowedSet.has(door.id) || allowedSet.has(room.id)
        }));

        const anyAllowed = allowedSet.has(room.id) || doorStatuses.some(d => d.allowed);
        
        // 🟢 Filter: insert only if user has access
        if (!anyAllowed) return;
        
        const badgeColor = this.builder.getAssignedRoomColor(room.id) ?? room.color ?? '#94a3b8';
        const roomSummary: RoomAccessSummary = {
          id: room.id,
          name: room.name ?? room.id,
          floor: floorData.floor,
          zoneName: zone.name,
          color: badgeColor,
          doors: doorStatuses,
          boundary: room.boundary,
          center: room.center
        };
        
        if (!floorMap.has(floorData.floor)) {
          floorMap.set(floorData.floor, []);
        }
        floorMap.get(floorData.floor)!.push(roomSummary);
      });
    });

    // Sort rooms within each floor by name, then return sorted by floor
    const result: { floor: number; rooms: RoomAccessSummary[] }[] = [];
    Array.from(floorMap.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([floor, rooms]) => {
        result.push({
          floor,
          rooms: rooms.sort((a, b) => a.name.localeCompare(b.name, 'th'))
        });
      });

    return result;
  }

  private buildRoomSummaries(allowList: string[]): RoomAccessSummary[] {
    const floorData = this.interaction.getCurrentFloorData();
    if (!floorData?.zones) {
      return [];
    }
    const allowedSet = new Set((allowList || []).filter(Boolean));

    const rooms: RoomAccessSummary[] = [];
    floorData.zones.forEach((zone: any) => {
      zone.rooms?.forEach((room: any) => {
        const doorStatuses: DoorStatus[] = (room.doors || []).map((door: any) => ({
          id: door.id,
          label: door.name ?? 'ประตู',
          allowed: allowedSet.has(door.id) || allowedSet.has(room.id)
        }));

        const anyAllowed = allowedSet.has(room.id) || doorStatuses.some(d => d.allowed);
        
        const badgeColor = this.builder.getAssignedRoomColor(room.id) ?? room.color ?? '#94a3b8';

        rooms.push({
          id: room.id,
          name: room.name ?? room.id,
          floor: floorData.floor,
          zoneName: zone.name,
          color: badgeColor,
          doors: doorStatuses,
          boundary: room.boundary,
          center: room.center
        });
      });
    });

    return rooms.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }

  private fadeColor(color: string): string {
    const sanitized = color.replace('#', '');
    const normalized = sanitized.length === 3
      ? sanitized.split('').map(c => c + c).join('')
      : sanitized.padStart(6, '0');
    const base = parseInt(normalized, 16);
    const r = (base >> 16) & 255;
    const g = (base >> 8) & 255;
    const b = base & 255;
    const mix = (component: number) => Math.round(component + (230 - component) * 0.6); 
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }

  // [เพิ่ม] ฟังก์ชันคำนวณสีตัวอักษร (ขาว/ดำ) ตามความสว่างของพื้นหลัง
  getContrastColor(hexColor: string): string {
    if (!hexColor) return '#000000';
    const sanitized = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
    const normalized = sanitized.length === 4
      ? `#${sanitized[1]}${sanitized[1]}${sanitized[2]}${sanitized[2]}${sanitized[3]}${sanitized[3]}`
      : sanitized.padEnd(7, '0');

    const r = parseInt(normalized.substring(1, 3), 16);
    const g = parseInt(normalized.substring(3, 5), 16);
    const b = parseInt(normalized.substring(5, 7), 16);

    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#1f2937' : '#ffffff';
  }
}

// หมายเหตุ: อย่าลืมเพิ่ม (click)="selectRoom(room)" ที่ <ion-item> ใน access-list.component.html