import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  Modal,
  Image,
  Alert,
  FlatList,
  BackHandler,
} from "react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useThemeStore } from "../../store/useThemeStore";
import { useOfflineStore } from "../../store/useOfflineStore";
import { Dropdown } from "../../components/CustomDropdown";
import { AttachmentSection } from "../../components/AttachmentSection";
import { Button } from "../../components/Button";
import { CustomAlert } from "../../components/CustomAlert";
import i18n from "../../i18n";
import dayjs from "dayjs";
import * as stockService from "../../services/api/stockService";
import {
  getPartnersForSelection,
  getInventoryAdjustmentProducts,
  getUomsByCategory,
} from "../../services/database/repositories";

interface ReturnLine {
  product_id: number;
  product_name: string;
  product_uom_id: number;
  product_uom_name: string;
  uom_category_id?: number;
  quantity: number;
}

interface LocalAttachment {
  name: string;
  uri: string;
  base64?: string;
}

interface GeneralReturnDetails {
  id: number;
  name: string;
  partner_id: number;
  partner_name: string;
  location_dest_id: number;
  location_dest_name: string;
  reason_id: number;
  reason_name: string;
  state: string;
  return_date: string | null;
  lines: {
    product_id: number;
    product_name: string;
    product_uom_id: number;
    product_uom_name: string;
    quantity: number;
  }[];
  attachments: {
    id: number;
    name: string;
    mimetype?: string;
    datas?: string;
  }[];
}

const parseProfileLocations = (repProfile: any) => {
  let locations: { id: number; name: string }[] = [];
  if (repProfile?.location_general_return_ids) {
    try {
      const parsed =
        typeof repProfile.location_general_return_ids === "string"
          ? JSON.parse(repProfile.location_general_return_ids)
          : repProfile.location_general_return_ids;
      if (Array.isArray(parsed)) {
        locations = parsed.map((loc: any) => {
          if (typeof loc === "object" && loc !== null) {
            return { id: loc.id, name: loc.display_name || loc.name };
          }
          return { id: loc, name: `Location #${loc}` };
        });
      }
    } catch (e) {
      console.warn("Failed to parse location_general_return_ids:", e);
    }
  }
  if (locations.length === 0 && repProfile?.location_general_return_id) {
    locations = [
      {
        id: repProfile.location_general_return_id,
        name:
          repProfile.location_general_return_name ||
          `Location #${repProfile.location_general_return_id}`,
      },
    ];
  }
  return locations;
};

const uriToBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export default function GeneralReturnFormScreen() {
  const { request_id } = useLocalSearchParams<{ request_id?: string }>();
  const isReadOnly = !!request_id;
  const { colors } = useThemeStore();
  const { isOffline, salesRepProfile } = useOfflineStore();
  const router = useRouter();
  const navigation = useNavigation();

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      setRefreshTrigger((prev) => prev + 1);
    });
    return unsubscribe;
  }, [navigation]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [details, setDetails] = useState<GeneralReturnDetails | null>(null);

  const [partners, setPartners] = useState<{ odoo_id: number; name: string }[]>(
    [],
  );
  const [reasons, setReasons] = useState<any[]>([]);
  const [locations, setLocations] = useState<{ id: number; name: string }[]>(
    [],
  );
  const [products, setProducts] = useState<any[]>([]);

  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [selectedReasonId, setSelectedReasonId] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [productSearch, setProductSearch] = useState("");
  const [uomModalVisible, setUomModalVisible] = useState(false);
  const [activeLineProductId, setActiveLineProductId] = useState<number | null>(
    null,
  );
  const [availableUoMs, setAvailableUoMs] = useState<any[]>([]);

  const [showDiscardAlert, setShowDiscardAlert] = useState(false);
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: "",
    message: "",
    onConfirm: () => setAlertConfig((prev) => ({ ...prev, visible: false })),
  });

  const resetForm = useCallback(() => {
    setLines([]);
    setAttachments([]);
    setProductSearch("");
    setDetails(null);
    setPreviewImage(null);
    setActiveLineProductId(null);
    if (partners.length > 0) {
      setSelectedPartnerId(partners[0].odoo_id.toString());
    } else {
      setSelectedPartnerId("");
    }
    if (locations.length > 0) {
      setSelectedLocationId(locations[0].id.toString());
    } else {
      setSelectedLocationId("");
    }
    if (reasons.length > 0) {
      setSelectedReasonId(reasons[0].id.toString());
    } else {
      setSelectedReasonId("");
    }
  }, [partners, locations, reasons]);

  useEffect(() => {
    return () => {
      setLines([]);
      setAttachments([]);
      setProductSearch("");
      setDetails(null);
    };
  }, []);

  const getStatusLabel = (state: string) => {
    const key = `general_return.state_${state}`;
    const translated = i18n.t(key);
    return translated !== key ? translated : state;
  };

  const getEffectiveLocationId = useCallback(() => {
    if (selectedLocationId) return selectedLocationId;
    if (locations.length === 1) return locations[0].id.toString();
    return "";
  }, [selectedLocationId, locations]);

  useEffect(() => {
    const backAction = () => {
      const hasChanges = !isReadOnly && (lines.length > 0 || attachments.length > 0);
      if (hasChanges) {
        setShowDiscardAlert(true);
        return true;
      }
      resetForm();
      router.navigate("/(drawer)/general_return");
      return true;
    };

    // Add the listener for the system back button
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction,
    );

    // Clean up the listener when the component unmounts
    return () => backHandler.remove();
  }, [router, isReadOnly, lines, attachments, resetForm]);

  // go back to general return list screen from the system back button
  const goBack = () => {
    const hasChanges = !isReadOnly && (lines.length > 0 || attachments.length > 0);
    if (hasChanges) {
      setShowDiscardAlert(true);
    } else {
      resetForm();
      router.navigate("/(drawer)/general_return");
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const loadCreateData = async () => {
      const partnerList = await getPartnersForSelection();
      if (cancelled) return;
      setPartners(partnerList);
      if (partnerList.length > 0) {
        setSelectedPartnerId(partnerList[0].odoo_id.toString());
      }

      await useOfflineStore.getState().fetchSalesRepProfile();
      const repProfile = useOfflineStore.getState().salesRepProfile;
      const locList = parseProfileLocations(repProfile);
      setLocations(locList);
      if (locList.length > 0) {
        setSelectedLocationId(locList[0].id.toString());
      } else {
        setSelectedLocationId("");
      }

      const productList = await getInventoryAdjustmentProducts();
      if (cancelled) return;
      setProducts(productList);

      const reasonsRes = await stockService.getGeneralReturnReasons();
      if (cancelled) return;
      if (reasonsRes?.data?.success) {
        const reasonList = reasonsRes.data.reasons || [];
        setReasons(reasonList);
        if (reasonList.length > 0) {
          setSelectedReasonId(reasonList[0].id.toString());
        }
      } else {
        throw new Error(
          reasonsRes?.data?.message || i18n.t("general_return.reasons_error"),
        );
      }
    };

    const loadDetails = async () => {
      const id = parseInt(
        Array.isArray(request_id) ? request_id[0] : request_id || "",
        10,
      );
      if (isNaN(id)) throw new Error(i18n.t("general_return.invalid_request"));

      const response = await stockService.getGeneralReturnDetails(id);
      if (cancelled) return;
      if (!response?.data?.success) {
        throw new Error(
          response?.data?.message || i18n.t("general_return.load_error"),
        );
      }
      setDetails(response.data.request);
    };

    const init = async () => {
      if (isOffline) {
        setAlertConfig({
          visible: true,
          title: i18n.t("common.error"),
          message: i18n.t("general_return.requires_online"),
          onConfirm: () => {
            setAlertConfig((prev) => ({ ...prev, visible: false }));
            router.back();
          },
        });
        return;
      }

      try {
        if (isReadOnly) {
          await loadDetails();
        } else {
          setLines([]);
          setAttachments([]);
          setProductSearch("");
          setDetails(null);
          await loadCreateData();
        }
      } catch (e: any) {
        if (!cancelled) {
          setAlertConfig({
            visible: true,
            title: i18n.t("common.error"),
            message: e.message || i18n.t("general_return.load_error"),
            onConfirm: () => {
              setAlertConfig((prev) => ({ ...prev, visible: false }));
              router.back();
            },
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [isReadOnly, request_id, refreshTrigger]);

  // Update destination when profile syncs — no extra online API calls
  useEffect(() => {
    if (isReadOnly || loading) return;
    const locList = parseProfileLocations(salesRepProfile);
    if (locList.length === 0) return;
    setLocations(locList);
    setSelectedLocationId((prev) => {
      if (prev && locList.some((loc) => loc.id.toString() === prev))
        return prev;
      return locList[0].id.toString();
    });
  }, [salesRepProfile, isReadOnly, loading]);

  const handleAddProduct = (product: any) => {
    if (lines.some((l) => l.product_id === product.odoo_id)) return;
    setLines((prev) => [
      ...prev,
      {
        product_id: product.odoo_id,
        product_name: product.name || product.display_name,
        product_uom_id: product.uom_id,
        product_uom_name: product.uom_name,
        uom_category_id: product.uom_category_id,
        quantity: 1,
      },
    ]);
  };

  const updateQty = (productId: number, delta: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.product_id === productId
          ? { ...l, quantity: Math.max(0, l.quantity + delta) }
          : l,
      ),
    );
  };

  const setQty = (productId: number, text: string) => {
    const num = parseFloat(text) || 0;
    setLines((prev) =>
      prev.map((l) =>
        l.product_id === productId ? { ...l, quantity: Math.max(0, num) } : l,
      ),
    );
  };

  const removeLine = (productId: number) => {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  };

  const openUoMSelection = async (line: ReturnLine) => {
    if (!line.uom_category_id) return;
    try {
      const uoms = await getUomsByCategory(line.uom_category_id);
      setAvailableUoMs(uoms);
      setActiveLineProductId(line.product_id);
      setUomModalVisible(true);
    } catch (e) {
      Alert.alert(i18n.t("common.error"), i18n.t("product.select_uom"));
    }
  };

  const selectUoM = (uom: any) => {
    if (activeLineProductId === null) return;
    setLines((prev) =>
      prev.map((l) =>
        l.product_id === activeLineProductId
          ? { ...l, product_uom_id: uom.odoo_id, product_uom_name: uom.name }
          : l,
      ),
    );
    setUomModalVisible(false);
    setActiveLineProductId(null);
  };

  const handleTakeAttachment = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          i18n.t("common.error"),
          i18n.t("general_return.camera_permission"),
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setIsUploadingAttachment(true);
      const asset = result.assets[0];
      const base64 = await uriToBase64(asset.uri);
      const fileName = asset.fileName || `photo_${Date.now()}.jpg`;

      setAttachments((prev) => [
        ...prev,
        { name: fileName, uri: asset.uri, base64 },
      ]);
    } catch (e) {
      console.error("Attachment capture failed:", e);
      Alert.alert(
        i18n.t("common.error"),
        i18n.t("general_return.attachment_error"),
      );
    } finally {
      setIsUploadingAttachment(false);
    }
  };

  const handleDeleteAttachment = (name: string) => {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  };

  const handleSubmit = async () => {
    const locationId = getEffectiveLocationId();

    if (!selectedPartnerId || !locationId || !selectedReasonId) {
      const message = !locationId
        ? i18n.t("general_return.no_destination")
        : i18n.t("general_return.missing_fields");
      setAlertConfig({
        visible: true,
        title: i18n.t("common.error"),
        message,
        onConfirm: () =>
          setAlertConfig((prev) => ({ ...prev, visible: false })),
      });
      return;
    }

    const submitLines = lines.filter((l) => l.quantity > 0);
    if (submitLines.length === 0) {
      setAlertConfig({
        visible: true,
        title: i18n.t("common.error"),
        message: i18n.t("general_return.enter_qty"),
        onConfirm: () =>
          setAlertConfig((prev) => ({ ...prev, visible: false })),
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await stockService.submitGeneralReturn({
        partner_id: parseInt(selectedPartnerId, 10),
        location_dest_id: parseInt(locationId, 10),
        reason_id: parseInt(selectedReasonId, 10),
        lines: submitLines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          product_uom_id: l.product_uom_id,
        })),
        attachments: attachments
          .filter((a) => a.base64)
          .map((a) => ({ name: a.name, base64: a.base64! })),
      });

      if (!response?.data?.success) {
        throw new Error(
          response?.data?.error ||
            response?.data?.message ||
            i18n.t("general_return.submit_error"),
        );
      }

      setAlertConfig({
        visible: true,
        title: i18n.t("common.success"),
        message: i18n.t("general_return.submit_success"),
        onConfirm: () => {
          setAlertConfig((prev) => ({ ...prev, visible: false }));
          resetForm();
          router.replace("/(drawer)/general_return");
        },
      });
    } catch (e: any) {
      setAlertConfig({
        visible: true,
        title: i18n.t("common.error"),
        message: e.message || i18n.t("general_return.submit_error"),
        onConfirm: () =>
          setAlertConfig((prev) => ({ ...prev, visible: false })),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = products
    .filter((p) => {
      const q = productSearch.toLowerCase();
      const name = (p.name || "").toLowerCase();
      const code = (p.default_code || "").toLowerCase();
      return name.includes(q) || code.includes(q);
    })
    .filter((p) => !lines.some((l) => l.product_id === p.odoo_id));

  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={["top"]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {isReadOnly
            ? details?.name || i18n.t("general_return.details_title")
            : i18n.t("general_return.new_title")}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {isReadOnly && details ? (
          <>
            <View
              style={[
                styles.infoCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.infoRow}>
                <Text
                  style={[styles.infoLabel, { color: colors.textSecondary }]}
                >
                  {i18n.t("general_return.status")}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {getStatusLabel(details.state)}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text
                  style={[styles.infoLabel, { color: colors.textSecondary }]}
                >
                  {i18n.t("general_return.customer")}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {details.partner_name}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text
                  style={[styles.infoLabel, { color: colors.textSecondary }]}
                >
                  {i18n.t("general_return.destination")}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {details.location_dest_name}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text
                  style={[styles.infoLabel, { color: colors.textSecondary }]}
                >
                  {i18n.t("returns.reason")}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {details.reason_name}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text
                  style={[styles.infoLabel, { color: colors.textSecondary }]}
                >
                  {i18n.t("general_return.return_date")}
                </Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>
                  {details.return_date
                    ? dayjs(details.return_date).format("YYYY-MM-DD")
                    : "—"}
                </Text>
              </View>
            </View>

            <Text
              style={[styles.sectionTitle, { color: colors.textSecondary }]}
            >
              {i18n.t("returns.products")}
            </Text>
            <View
              style={[
                styles.glassCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              {details.lines.map((line, idx) => (
                <View
                  key={line.product_id}
                  style={[
                    styles.lineItem,
                    idx < details.lines.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border + "40",
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lineName, { color: colors.text }]}>
                      {line.product_name}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {line.quantity} {line.product_uom_name}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {details.attachments.length > 0 && (
              <>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: colors.textSecondary, marginTop: 16 },
                  ]}
                >
                  {i18n.t("order.attachments")}
                </Text>
                <View
                  style={[
                    styles.glassCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  {details.attachments.map((att, idx) => {
                    const uri = att.datas
                      ? `data:${att.mimetype || "image/jpeg"};base64,${att.datas}`
                      : null;
                    return (
                      <TouchableOpacity
                        key={att.id || idx}
                        style={styles.attachmentRow}
                        onPress={() => uri && setPreviewImage(uri)}
                        disabled={!uri}
                      >
                        <Ionicons
                          name="image-outline"
                          size={20}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.attachmentName,
                            { color: colors.text },
                          ]}
                          numberOfLines={1}
                        >
                          {att.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
          </>
        ) : (
          <>
            <Text
              style={[styles.sectionTitle, { color: colors.textSecondary }]}
            >
              {i18n.t("general_return.customer")}
            </Text>
            {partners.length > 0 ? (
              <Dropdown
                items={partners.map((p) => ({
                  label: p.name,
                  value: p.odoo_id.toString(),
                }))}
                selectedValue={selectedPartnerId}
                onSelect={setSelectedPartnerId}
                placeholder={i18n.t("general_return.select_customer")}
              />
            ) : (
              <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>
                {i18n.t("general_return.no_customers")}
              </Text>
            )}

            {locations.length === 1 && (
              <>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: colors.textSecondary, marginTop: 16 },
                  ]}
                >
                  {i18n.t("general_return.destination")}
                </Text>
                <View
                  style={[
                    styles.singleLocationCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color={colors.primary}
                  />
                  <Text
                    style={[styles.singleLocationText, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {locations[0].name}
                  </Text>
                </View>
              </>
            )}

            {locations.length > 1 && (
              <>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: colors.textSecondary, marginTop: 16 },
                  ]}
                >
                  {i18n.t("general_return.destination")}
                </Text>
                <Dropdown
                  items={locations.map((loc) => ({
                    label: loc.name,
                    value: loc.id.toString(),
                  }))}
                  selectedValue={selectedLocationId}
                  onSelect={setSelectedLocationId}
                  placeholder={i18n.t("general_return.select_destination")}
                />
              </>
            )}

            {locations.length === 0 && (
              <View
                style={[
                  styles.warningBox,
                  {
                    backgroundColor: colors.danger + "12",
                    borderColor: colors.danger + "30",
                  },
                ]}
              >
                <Ionicons
                  name="warning-outline"
                  size={18}
                  color={colors.danger}
                />
                <Text style={[styles.warningText, { color: colors.danger }]}>
                  {i18n.t("general_return.no_destination")}
                </Text>
              </View>
            )}

            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textSecondary, marginTop: 16 },
              ]}
            >
              {i18n.t("returns.reason")}
            </Text>
            {reasons.length > 0 ? (
              <Dropdown
                items={reasons.map((r) => ({
                  label: r.name,
                  value: r.id.toString(),
                }))}
                selectedValue={selectedReasonId}
                onSelect={setSelectedReasonId}
                placeholder={i18n.t("returns.select_reason")}
              />
            ) : (
              <Text style={{ color: colors.textSecondary }}>
                {i18n.t("returns.no_reasons")}
              </Text>
            )}

            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textSecondary, marginTop: 20 },
              ]}
            >
              {i18n.t("returns.products")}
            </Text>
            <View
              style={[
                styles.searchBar,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder={i18n.t("common.search_products")}
                placeholderTextColor={colors.textSecondary}
                value={productSearch}
                onChangeText={setProductSearch}
              />
            </View>

            {productSearch.length > 0 && filteredProducts.length > 0 && (
              <View
                style={[
                  styles.productPicker,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {filteredProducts.slice(0, 8).map((product) => (
                  <TouchableOpacity
                    key={product.odoo_id}
                    style={[
                      styles.productPickerItem,
                      { borderBottomColor: colors.border },
                    ]}
                    onPress={() => {
                      handleAddProduct(product);
                      setProductSearch("");
                    }}
                  >
                    <Text
                      style={{ color: colors.text, flex: 1 }}
                      numberOfLines={1}
                    >
                      {product.name}
                    </Text>
                    <Ionicons
                      name="add-circle"
                      size={22}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {lines.length > 0 ? (
              <View
                style={[
                  styles.glassCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    marginTop: 12,
                  },
                ]}
              >
                {lines.map((line, idx) => (
                  <View
                    key={line.product_id}
                    style={[
                      styles.lineItem,
                      idx < lines.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border + "40",
                      },
                    ]}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text
                        style={[styles.lineName, { color: colors.text }]}
                        numberOfLines={2}
                      >
                        {line.product_name}
                      </Text>
                      <TouchableOpacity
                        onPress={() => openUoMSelection(line)}
                        style={styles.uomBadge}
                      >
                        <Text style={{ color: colors.primary, fontSize: 12 }}>
                          {line.product_uom_name}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={12}
                          color={colors.primary}
                        />
                      </TouchableOpacity>
                    </View>
                    <View
                      style={[
                        styles.stepper,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                        },
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.stepBtn}
                        onPress={() => updateQty(line.product_id, -1)}
                      >
                        <Ionicons name="remove" size={18} color={colors.text} />
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.stepInput, { color: colors.text }]}
                        value={line.quantity.toString()}
                        onChangeText={(val) => setQty(line.product_id, val)}
                        keyboardType="numeric"
                        textAlign="center"
                      />
                      <TouchableOpacity
                        style={styles.stepBtn}
                        onPress={() => updateQty(line.product_id, 1)}
                      >
                        <Ionicons name="add" size={18} color={colors.text} />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      onPress={() => removeLine(line.product_id)}
                      style={{ marginLeft: 8 }}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color={colors.danger}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
                {i18n.t("general_return.add_products_hint")}
              </Text>
            )}

            <AttachmentSection
              colors={colors}
              attachments={attachments}
              isUploadingAttachment={isUploadingAttachment}
              onTakeAttachment={handleTakeAttachment}
              onDeleteAttachment={handleDeleteAttachment}
              onPreviewImage={setPreviewImage}
            />
          </>
        )}
      </ScrollView>

      {!isReadOnly && (
        <View
          style={[
            styles.footer,
            { borderTopColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <View style={styles.footerInfo}>
            <Text style={[styles.footerSub, { color: colors.textSecondary }]}>
              {i18n.t("returns.items_to_return")}
            </Text>
            <Text style={[styles.footerPrice, { color: colors.text }]}>
              {totalQty}
            </Text>
          </View>
          <Button
            title={i18n.t("common.submit")}
            onPress={handleSubmit}
            disabled={submitting || totalQty === 0}
            style={styles.submitBtn}
            variant={totalQty > 0 ? "primary" : "outline"}
          />
        </View>
      )}

      <Modal
        visible={uomModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setUomModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.background },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {i18n.t("product.select_uom")}
              </Text>
              <TouchableOpacity onPress={() => setUomModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={availableUoMs}
              keyExtractor={(item) => item.odoo_id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.uomItem, { borderBottomColor: colors.border }]}
                  onPress={() => selectUoM(item)}
                >
                  <Text style={{ color: colors.text }}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <View style={styles.previewOverlay}>
          <TouchableOpacity
            style={styles.previewClose}
            onPress={() => setPreviewImage(null)}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {previewImage && (
            <Image
              source={{ uri: previewImage }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        onConfirm={alertConfig.onConfirm}
      />

      <CustomAlert
        visible={showDiscardAlert}
        title={i18n.t("common.discard_changes_title") || "Discard Changes"}
        message={i18n.t("common.discard_changes_msg") || "Are you sure you want to discard all unsaved changes?"}
        onConfirm={() => {
          setShowDiscardAlert(false);
          resetForm();
          router.navigate("/(drawer)/general_return");
        }}
        onCancel={() => setShowDiscardAlert(false)}
        confirmText={i18n.t("common.discard") || "Discard"}
        confirmColor="red"
        cancelText={i18n.t("common.cancel") || "Cancel"}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  content: { padding: 16, paddingBottom: 120 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  infoCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  infoLabel: { fontSize: 13, flex: 1 },
  infoValue: { fontSize: 14, fontWeight: "600", flex: 1.5, textAlign: "right" },
  glassCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  lineItem: { flexDirection: "row", alignItems: "center", padding: 14 },
  lineName: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  uomBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  stepBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  stepInput: { width: 44, height: 36, fontSize: 15, fontWeight: "700" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 15 },
  singleLocationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },
  singleLocationText: { flex: 1, fontSize: 15, fontWeight: "600" },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    marginBottom: 4,
  },
  warningText: { flex: 1, fontSize: 13, fontWeight: "500" },
  productPicker: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  productPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
  attachmentName: { flex: 1, fontSize: 14 },
  footer: {
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  footerInfo: { flex: 1 },
  footerSub: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  footerPrice: { fontSize: 24, fontWeight: "800" },
  submitBtn: { flex: 1.5, height: 52, borderRadius: 14 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    maxHeight: "50%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  uomItem: { paddingVertical: 14, borderBottomWidth: 1 },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
  },
  previewClose: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  previewImage: { width: "100%", height: "80%" },
});
