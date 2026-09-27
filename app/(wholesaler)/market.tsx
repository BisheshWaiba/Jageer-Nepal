// app/(wholesaler)/market.tsx
import { useState } from 'react';
import { Text, TextInput, Pressable, View, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CatalogStockingList } from '../../lib/components/CatalogStockingList';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { useSupabaseInsert } from '../../lib/hooks/useSupabase';
import { pickAndUploadCatalogImage } from '../../lib/utils/catalogImage';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { parseAmount, decimalInput, digitsInput } from '../../lib/utils/number';

function CreateProductForm({ onDone }: { onDone: () => void }) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const insertItem = useSupabaseInsert('catalog_products');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [uploading, setUploading] = useState(false);

  async function handlePickImage() {
    setUploading(true);
    try {
      const url = await pickAndUploadCatalogImage();
      if (url) setImageUrl(url);
    } catch (err) {
      showAlert('Could not upload photo', getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!userId) return;
    if (!name.trim()) {
      showAlert('Add a name', 'Product name is required.');
      return;
    }
    // Strict parsing - parseFloat("12abc") used to accept 12.
    const priceNum = parseAmount(price);
    if (priceNum == null || priceNum <= 0) {
      showAlert('Set a price', 'Enter a valid price before submitting.');
      return;
    }
    const stockNum = stock.trim() ? Number(stock) : 0;
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      showAlert('Check the stock', 'Starting stock must be a whole number, 0 or more.');
      return;
    }
    try {
      await insertItem.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        image_url: imageUrl.trim() || null,
        is_active: false,
        submitted_by: userId,
        pending_price: priceNum,
        pending_stock: stockNum,
      });
      showAlert(
        'Submitted for review',
        'An admin needs to approve this before it goes live on the Products tab and in the marketplace.'
      );
      onDone();
    } catch (err) {
      showAlert('Could not submit product', getErrorMessage(err));
    }
  }

  return (
    <View className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <Text className="mb-1 text-sm font-medium text-gray-700">Product name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Samsung Galaxy A54 5G"
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <Text className="mb-1 text-sm font-medium text-gray-700">Description (optional)</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="e.g. 8GB/128GB, 5000mAh battery"
        multiline
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <Text className="mb-1 text-sm font-medium text-gray-700">Category (optional)</Text>
      <TextInput
        value={category}
        onChangeText={setCategory}
        placeholder="e.g. Mobile Phones"
        className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <Text className="mb-1 text-sm font-medium text-gray-700">Photo (optional)</Text>
      <Pressable
        onPress={handlePickImage}
        disabled={uploading}
        className="mb-3 h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-gray-300 bg-gray-50"
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} className="h-full w-full" resizeMode="cover" />
        ) : (
          <Ionicons name={uploading ? 'hourglass-outline' : 'camera'} size={22} color="#9CA3AF" />
        )}
      </Pressable>

      <View className="mb-3 flex-row gap-3">
        <View className="flex-1">
          <Text className="mb-1 text-sm font-medium text-gray-700">Your price to resellers (NPR)</Text>
          <TextInput
            value={price}
            onChangeText={(v) => setPrice(decimalInput(v))}
            placeholder="0.00"
            keyboardType="decimal-pad"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </View>
        <View className="flex-1">
          <Text className="mb-1 text-sm font-medium text-gray-700">Starting stock</Text>
          <TextInput
            value={stock}
            onChangeText={(v) => setStock(digitsInput(v))}
            placeholder="0"
            keyboardType="number-pad"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </View>
      </View>

      <Pressable
        onPress={handleSubmit}
        disabled={insertItem.isPending}
        className="items-center rounded-lg bg-orange-500 py-2.5 disabled:opacity-50"
      >
        <Text className="text-sm font-semibold text-white">
          {insertItem.isPending ? 'Submitting…' : 'Submit for review'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function WholesaleMarket() {
  const [showForm, setShowForm] = useState(false);

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="mb-1 flex-row items-center justify-end">
        <Pressable onPress={() => setShowForm((v) => !v)} className="rounded-lg bg-orange-500 px-3 py-2">
          <Text className="text-xs font-semibold text-white">{showForm ? 'Cancel' : '+ Create Product'}</Text>
        </Pressable>
      </View>
      <Text className="mb-5 text-sm text-gray-500">
        Set quantity and your price for anything you carry — resellers buy from you at this price. Launching
        something new? Submit it for admin review with Create Product.
      </Text>

      {showForm && <CreateProductForm onDone={() => setShowForm(false)} />}

      <CatalogStockingList priceLabel="Your price to resellers" basePath="/(wholesaler)" />
    </ScrollView>
  );
}
