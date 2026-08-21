import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/lib/AuthContext";
import { colors } from "./src/lib/theme";
import ArchiveScreen from "./src/screens/ArchiveScreen";
import AuthScreen from "./src/screens/AuthScreen";
import EditTaskScreen from "./src/screens/EditTaskScreen";
import NewTaskScreen from "./src/screens/NewTaskScreen";
import TaskListScreen from "./src/screens/TaskListScreen";
import TodayScreen from "./src/screens/TodayScreen";
import type { TasksStackParamList } from "./src/navigation/types";

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Today: "home-outline",
  "New Task": "add-circle-outline",
  "My Tasks": "list-outline",
  Archive: "archive-outline",
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

const Tab = createBottomTabNavigator();
const TodayStack = createNativeStackNavigator<TasksStackParamList>();
const TaskListStack = createNativeStackNavigator<TasksStackParamList>();
const ArchiveStack = createNativeStackNavigator<TasksStackParamList>();

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
      <TaskListStack.Screen name="TaskList" component={TaskListScreen} options={{ title: "My Tasks" }} />
      <TaskListStack.Screen name="EditTask" component={EditTaskScreen} />
    </TaskListStack.Navigator>
  );
}

function ArchiveStackNavigator() {
  return (
    <ArchiveStack.Navigator screenOptions={screenOptions}>
      <ArchiveStack.Screen name="ArchiveList" component={ArchiveScreen} options={{ title: "Archive" }} />
      <ArchiveStack.Screen name="EditTask" component={EditTaskScreen} options={{ title: "Edit Task" }} />
    </ArchiveStack.Navigator>
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
        <Tab.Screen name="New Task" component={NewTaskScreen} />
        <Tab.Screen
          name="My Tasks"
          component={TaskListStackNavigator}
          options={{ headerShown: false }}
        />
        <Tab.Screen
          name="Archive"
          component={ArchiveStackNavigator}
          options={{ headerShown: false }}
        />
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
});
