import { View, Text, StyleSheet } from 'react-native';

export default function ActiveService() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Servicio Activo</Text>
      <Text style={styles.subtitle}>No hay servicio activo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
