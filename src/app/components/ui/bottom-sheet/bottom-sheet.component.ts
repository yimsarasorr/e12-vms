import { Component, inject, ElementRef, ViewChild, Renderer2, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { BottomSheetService, SheetData, ExpansionState } from '../../../services/bottom-sheet.service';
import { AccessListComponent } from '../../access-list/access-list.component';
import { FloorplanInteractionService } from '../../../services/floorplan/floorplan-interaction.service';

// 1. Import addIcons และชื่อ Icon ที่ใช้
import { addIcons } from 'ionicons';
import {
  business,
  businessOutline,
  close,
  cubeOutline,
  navigateOutline,
  chevronForwardOutline,
  arrowBack // เพิ่ม icon ย้อนกลับ
} from 'ionicons/icons';

@Component({
  selector: 'app-bottom-sheet',
  standalone: true,
  imports: [CommonModule, IonicModule, AccessListComponent],
  templateUrl: './bottom-sheet.component.html',
  styleUrls: ['./bottom-sheet.component.scss']
})
export class BottomSheetComponent implements OnInit {
  public bottomSheetService = inject(BottomSheetService);
  private renderer = inject(Renderer2);
  private interactionService = inject(FloorplanInteractionService); // inject เพื่อเรียก clearFocus

  @ViewChild('sheet') sheetRef!: ElementRef;

  currentData: SheetData = { mode: 'hidden' };
  currentState: 'hidden' | ExpansionState = 'peek';

  private startY = 0;
  private startHeight = 0;
  private isDragging = false;

  constructor() {
    // 2. Register Icon ทั้งหมดที่ใช้ใน HTML ของหน้านี้
    addIcons({
      business,
      businessOutline,
      close,
      cubeOutline,
      navigateOutline,
      chevronForwardOutline,
      arrowBack // register icon ใหม่
    });
  }

  ngOnInit() {
    // 1. Subscribe Content
    this.bottomSheetService.sheetState$.subscribe(data => {
      this.currentData = data;
      if (data.mode === 'hidden') {
        this.setState('hidden');
        return;
      }

      const nextState = this.bottomSheetService.getCurrentExpansionState();
      this.setState(nextState);
    });

    // 2. Subscribe Height State
    this.bottomSheetService.expansionState$.subscribe(state => {
      this.setState(state);
    });
  }

  // --- Logic การลาก (เหมือนเดิม) ---
  onTouchStart(event: TouchEvent | MouseEvent) {
    this.isDragging = true;
    this.startY = this.getClientY(event);
    const el = this.sheetRef.nativeElement;
    this.startHeight = el.offsetHeight;
    this.renderer.setStyle(el, 'transition', 'none');
  }

  onTouchMove(event: TouchEvent | MouseEvent) {
    if (!this.isDragging) return;
    const clientY = this.getClientY(event);
    const deltaY = this.startY - clientY;
    const newHeight = this.startHeight + deltaY;
    const maxHeight = window.innerHeight - 60;

    if (newHeight > 0 && newHeight <= maxHeight) {
      this.renderer.setStyle(this.sheetRef.nativeElement, 'height', `${newHeight}px`);
    }
  }

  onTouchEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    const el = this.sheetRef.nativeElement;
    this.renderer.setStyle(el, 'transition', 'height 0.4s cubic-bezier(0.25, 1, 0.5, 1)');
    this.renderer.removeStyle(el, 'height');

    // [แก้ไข] เลือก State ที่ใกล้ที่สุดจาก snap points (รวม partial)
    const currentHeight = el.offsetHeight;
    const snaps: { state: ExpansionState; height: number }[] = [
      { state: 'peek', height: this.getSnapPoint('peek') },
      { state: 'partial', height: this.getSnapPoint('partial') },
      { state: 'default', height: this.getSnapPoint('default') },
      { state: 'expanded', height: this.getSnapPoint('expanded') }
    ];
    const nearest = snaps.reduce((best, s) => {
      const d = Math.abs(currentHeight - s.height);
      return d < best.dist ? { dist: d, state: s.state } : best;
    }, { dist: Number.POSITIVE_INFINITY, state: 'peek' as ExpansionState });

    this.setState(nearest.state, true);
  }

  private getClientY(event: TouchEvent | MouseEvent): number {
    return event instanceof TouchEvent ? event.touches[0].clientY : event.clientY;
  }

  private setState(state: 'hidden' | ExpansionState, emit = false) {
    if (this.currentState === state) return;
    this.currentState = state;

    if (emit && state !== 'hidden') {
      this.bottomSheetService.setExpansionState(state as ExpansionState);
    }
  }

  selectBuilding(item: any) {
    this.bottomSheetService.triggerAction('enter-building', item.id);
  }

  backToList() {
    this.bottomSheetService.close();
  }

  // ฟังก์ชันกดปุ่มย้อนกลับจากหน้า Room Detail
  onBackFromDetail() {
    // 1. เคลียร์ Focus กล้อง 3D (ให้กลับไปหาผู้เล่น)
    this.interactionService.clearFocus();

    // 2. สั่ง Bottom Sheet ย้อนกลับไปหน้า Access List (ส่งข้อมูลเดิมกลับไปแบบง่ายๆ)
    const previousData: any[] = []; // สามารถดึงจาก floorData/permission ปัจจุบันมาแทนได้ภายหลัง
    this.bottomSheetService.goBackToAccessList(previousData);
  }

  accentSurface(color?: string, alpha = 0.18): string {
    return this.withAlpha(color, alpha, 0.18);
  }

  accentBorder(color?: string, alpha = 0.45): string {
    return this.withAlpha(color, alpha, 0.45);
  }

  accentText(color?: string): string {
    if (!color) {
      return '#2563eb';
    }
    return color.startsWith('hsla') ? color.replace(/hsla\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'hsl($1,$2,$3)') : color;
  }

  private withAlpha(color: string | undefined, explicitAlpha?: number, fallbackAlpha?: number): string {
    const alpha = explicitAlpha ?? fallbackAlpha ?? 0.2;
    if (!color) {
      return `rgba(148, 163, 184, ${alpha})`;
    }

    if (color.startsWith('hsla')) {
      return color;
    }

    if (color.startsWith('hsl')) {
      return color.replace('hsl', 'hsla').replace(')', `, ${alpha})`);
    }

    if (color.startsWith('#')) {
      const { r, g, b } = this.hexToRgb(color);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    return color;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const sanitized = hex.replace('#', '');
    const value = sanitized.length === 3
      ? sanitized.split('').map(char => char + char).join('')
      : sanitized.padEnd(6, '0');
    const numeric = parseInt(value, 16);
    return {
      r: (numeric >> 16) & 255,
      g: (numeric >> 8) & 255,
      b: numeric & 255
    };
  }

  // [เพิ่ม] คำนวณความสูง snap ต่อ state (peek/partial/default/expanded)
  private getSnapPoint(state: ExpansionState): number {
    switch (state) {
      case 'peek': return 80; // ให้สอดคล้องกับ CSS
      case 'partial': return Math.round(window.innerHeight * 0.3);
      case 'default': return Math.round(window.innerHeight * 0.5);
      case 'expanded': return Math.round(window.innerHeight);
      default: return 80;
    }
  }
}