import { Component, OnInit, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Vehicle } from '../../data/models';

@Component({
  selector: 'app-add-vehicle-modal',
  templateUrl: './add-vehicle-modal.component.html',
  styleUrls: ['./add-vehicle-modal.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, ReactiveFormsModule]
})
export class AddVehicleModalComponent implements OnInit {

  @Input() editVehicle?: Vehicle; // Add Input to accept vehicle for editing

  vehicleForm: FormGroup;
  isEditMode: boolean = false;

  // Mock Data for Selectors
  vehicleTypes = [
    { value: 'car', label: 'รถยนต์ทั่วไป', icon: 'car-sport' },
    { value: 'ev', label: 'รถไฟฟ้า (EV)', icon: 'flash' },
    { value: 'motorcycle', label: 'รถจักรยานยนต์', icon: 'bicycle' },
    { value: 'other', label: 'อื่นๆ', icon: 'ellipsis-horizontal' }
  ];

  brands = [
    'Toyota', 'Honda', 'Nissan', 'Mazda', 'Mitsubishi', 'Isuzu',
    'Suzuki', 'Ford', 'MG', 'BMW', 'Mercedes-Benz', 'BYD', 'GWM', 'Tesla', 'อื่นๆ'
  ];

  provinces = [
    'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท',
    'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม',
    'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์',
    'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์',
    'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง',
    'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ',
    'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย',
    'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี'
  ];

  selectedImage: string | null = null;

  // Custom states for ion-popover logic
  selectedTypeLabel: string = 'เลือกประเภท';
  selectedBrandLabel: string = 'เลือกยี่ห้อ';
  selectedProvinceLabel: string = 'จังหวัด';

  constructor(
    private modalCtrl: ModalController,
    private fb: FormBuilder
  ) {
    this.vehicleForm = this.fb.group({
      type: ['car', Validators.required],
      customType: [''], // Optional, required contextually via UI
      brand: ['', Validators.required],
      customBrand: [''], // Optional, required contextually via UI
      model: ['', Validators.required],
      color: ['', Validators.required],
      licensePlate: ['', [Validators.required, Validators.pattern(/^[0-9ก-ฮ]{1,3}[0-9ก-ฮ]{1,2} [0-9]{1,4}$/)]], // Basic Thai plate regex
      province: ['กรุงเทพมหานคร', Validators.required]
    });
  }

  ngOnInit() {
    if (this.editVehicle) {
      this.isEditMode = true;
      this.selectedImage = this.editVehicle.image || null;

      // Attempt to split model into brand and model part if they were concatenated
      let brand = '';
      let modelPart = this.editVehicle.model || '';

      // Parse prepended custom type (if present) like "[รถบัส] Honda Civic"
      let parsedType = 'car';
      const typeMatch = modelPart.match(/^\[(.*?)\]\s?(.*)/);
      if (typeMatch) {
        parsedType = typeMatch[1]; // e.g. "รถบัส"
        modelPart = typeMatch[2]; // e.g. "Honda Civic"
      }

      // Basic splitting logic for brand and model
      if (modelPart.includes(' ')) {
        const parts = modelPart.split(' ');
        brand = parts[0];
        modelPart = parts.slice(1).join(' ');
      } else {
        brand = modelPart;
        modelPart = '';
      }

      // Determine initialType based on parsedType and vehicle_type_code (if we had it, fallback to parsing)
      const isKnownType = ['car', 'ev', 'motorcycle'].includes(parsedType);
      const initialType = isKnownType ? parsedType : 'other';
      const initialCustomType = isKnownType ? '' : parsedType;

      const initialBrand = this.brands.includes(brand) ? brand : (brand ? 'อื่นๆ' : '');
      const initialProvince = this.editVehicle.province || 'กรุงเทพมหานคร';

      this.vehicleForm.patchValue({
        type: initialType,
        customType: initialCustomType,
        brand: initialBrand,
        customBrand: this.brands.includes(brand) ? '' : brand,
        model: modelPart,
        color: this.editVehicle.color || '',
        licensePlate: this.editVehicle.licensePlate || '',
        province: initialProvince
      });

      // Update selected popover labels for edit mode
      const typeOption = this.vehicleTypes.find(t => t.value === initialType);
      if (typeOption) this.selectedTypeLabel = typeOption.label;
      if (initialBrand) this.selectedBrandLabel = initialBrand;
      if (initialProvince) this.selectedProvinceLabel = initialProvince;

    } else {
      // Default image based on type
      this.updateDefaultImage();
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        this.selectedImage = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  // Popover Selectors Methods
  selectType(val: string, label: string) {
    this.vehicleForm.patchValue({ type: val });
    this.selectedTypeLabel = label;
  }

  selectBrand(val: string) {
    this.vehicleForm.patchValue({ brand: val });
    this.selectedBrandLabel = val;
  }

  selectProvince(val: string) {
    this.vehicleForm.patchValue({ province: val });
    this.selectedProvinceLabel = val;
  }

  updateDefaultImage() {
    if (this.selectedImage) return; // User uploaded overrides default

    // Simple placeholder logic
    const type = this.vehicleForm.get('type')?.value;
    // In real app, map to assets. For now use placeholder.
  }

  close() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  submit() {
    console.log('[AddVehicleModal] Submit called');
    if (this.vehicleForm.valid) {
      console.log('[AddVehicleModal] Form is valid');
      const formValue = this.vehicleForm.value;

      // Extract actual type and brand, using custom inputs if 'other' is selected
      const actualType = formValue.type === 'other' ? formValue.customType : formValue.type;
      const actualBrand = formValue.brand === 'อื่นๆ' ? formValue.customBrand : formValue.brand;

      // Ensure custom values are not empty if 'other' is selected
      if (formValue.type === 'other' && !actualType) {
        this.vehicleForm.get('customType')?.setErrors({ required: true });
        this.vehicleForm.get('customType')?.markAsTouched();
        return; // Stop submission
      }

      if (formValue.brand === 'อื่นๆ' && !actualBrand) {
        this.vehicleForm.get('customBrand')?.setErrors({ required: true });
        this.vehicleForm.get('customBrand')?.markAsTouched();
        return; // Stop submission
      }

      // Compose the model string prepending the actual custom type
      const finalModelName = `${actualBrand} ${formValue.model}`.trim();
      const dbModelString = actualType && !['car', 'ev', 'motorcycle'].includes(actualType)
        ? `[${actualType}] ${finalModelName}`
        : finalModelName;

      // Construct Vehicle Object
      const newVehicle: Partial<Vehicle> = {
        type: actualType, // Keep it for local usage, but it won't be sent to DB
        model: dbModelString,
        licensePlate: formValue.licensePlate, // Send clean plate, province is separate
        province: formValue.province,
        color: formValue.color, // Add color
        image: this.selectedImage || 'https://img.freepik.com/free-photo/blue-car-speed-motion-stretch-style_53876-126838.jpg', // Fallback
        isDefault: this.isEditMode ? this.editVehicle?.isDefault : false,
        status: this.isEditMode ? this.editVehicle?.status : 'active',
        lastUpdate: 'เพิ่งเพิ่ม'
      };

      if (this.isEditMode && this.editVehicle?.id) {
        newVehicle.id = this.editVehicle.id;
      }

      this.modalCtrl.dismiss(newVehicle, 'confirm');
    } else {
      console.warn('[AddVehicleModal] Form is invalid');
      this.vehicleForm.markAllAsTouched();

      // Log errors
      Object.keys(this.vehicleForm.controls).forEach(key => {
        const controlErrors = this.vehicleForm.get(key)?.errors;
        if (controlErrors) {
          console.error(`[AddVehicleModal] Invalid control: ${key}`, controlErrors);
        }
      });
    }
  }

  // Helper for validation display
  isControlInvalid(controlName: string): boolean {
    const control = this.vehicleForm.get(controlName);
    return !!(control && control.invalid && control.touched);
  }
}
