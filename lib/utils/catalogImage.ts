// lib/utils/catalogImage.ts
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../supabase';
import { useAuthStore } from '../hooks/useAuth';
import { showAlert } from './alert';
import { resizeImageForUpload } from './resizeImage';

export async function pickAndUploadCatalogImage(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    showAlert('Photo access needed', 'Allow photo library access to upload a product photo.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: true,
    aspect: [1, 1],
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const resizedUri = await resizeImageForUpload(asset.uri, asset.width, 1024);
  const arraybuffer = await fetch(resizedUri).then((res) => res.arrayBuffer());
  // Admins manage catalog/ directly; a wholesaler's product submission goes
  // under submissions/<their id>/, the only place they may upload (0079) -
  // and as a fresh file, since they may add but not overwrite.
  const profile = useAuthStore.getState().profile;
  const isAdmin = profile?.role === 'admin';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const path = isAdmin ? `catalog/${fileName}` : `submissions/${profile?.id}/${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from('catalog-images')
    .upload(path, arraybuffer, { contentType: 'image/jpeg', upsert: isAdmin });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('catalog-images').getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}
