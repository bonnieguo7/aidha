import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator, type BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/lib/AuthContext";
import { colors } from "./src/lib/theme";
import AuthScreen from "./src/screens/AuthScreen";
import EditTaskScreen from "./src/screens/EditTaskScreen";
import NewTaskScreen from "./src/screens/NewTaskScreen";
import TaskListScreen from "./src/screens/TaskListScreen";
import TodayScreen from "./src/screens/TodayScreen";
import type { TasksStackParamList } from "./src/navigation/types";

// Without this, expo-notifications' default behavior suppresses the alert
// banner for a notification that fires while the app is in the foreground -
// every "leaving by" and "due" reminder still gets scheduled correctly, it
// just silently doesn't show anything if you happen to have the app open
// when it fires. Set once, at module scope, before anything renders.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Today: "home-outline",
  Tasks: "list-outline",
};

const screenOptions = {
  headerRight: () => <SignOutButton />,
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
};

const tabScreenOptions = ({ route }: { route: { name: string } }) => ({
  ...screenOptions,
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.textMuted,
  tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
  tabBarIcon: ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={TAB_ICONS[route.name] ?? "ellipse-outline"} size={size} color={color} />
  ),
});

// Renders the "New Task" tab as a raised circular button instead of the
// normal icon+label tab item, replacing the default tabBarButton entirely -
// it still receives the tab's own onPress, so it navigates like any other tab.
function NewTaskTabButton({ onPress, accessibilityState }: BottomTabBarButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New Task"
      accessibilityState={accessibilityState}
      style={styles.fabButton}
    >
      <Ionicons name="add" size={28} color={colors.onSurfaceInverse} />
    </Pressable>
  );
}

const Tab = createBottomTabNavigator();
const TodayStack = createNativeStackNavigator<TasksStackParamList>();
const TaskListStack = createNativeStackNavigator<TasksStackParamList>();

function TodayStackNavigator() {
  return (
    <TodayStack.Navigator screenOptions={screenOptions}>
      {/* TodayScreen renders its own header (avatar, name, settings gear), so the
          native stack header is turned off just for this one screen. */}
      <TodayStack.Screen name="TodayList" component={TodayScreen} options={{ headerShown: false }} />
      <TodayStack.Screen name="EditTask" component={EditTaskScreen} />
    </TodayStack.Navigator>
  );
}

function TaskListStackNavigator() {
  return (
    <TaskListStack.Navigator screenOptions={screenOptions}>
      {/* TaskListScreen sets its own dynamic title/header (Tasks <-> Archive
          toggle), so it manages its own headerRight instead of inheriting
          screenOptions.headerRight - see its useLayoutEffect. */}
      <TaskListStack.Screen name="TaskList" component={TaskListScreen} options={{ title: "Tasks" }} />
      <TaskListStack.Screen name="EditTask" component={EditTaskScreen} />
    </TaskListStack.Navigator>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <Pressable onPress={signOut} hitSlop={8}>
      <Text style={styles.signOut}>Sign out</Text>
    </Pressable>
  );
}

function AppNavigator() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <NavigationContainer>
      <Tab.Navigator initialRouteName="Today" screenOptions={tabScreenOptions}>
        <Tab.Screen name="Today" component={TodayStackNavigator} options={{ headerShown: false }} />
        <Tab.Screen name="New Task" component={NewTaskScreen} options={{ tabBarButton: NewTaskTabButton }} />
        <Tab.Screen name="Tasks" component={TaskListStackNavigator} options={{ headerShown: false }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppNavigator />
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  signOut: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "600",
    marginRight: 12,
  },
  fabButton: {
    top: -20,
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
});
